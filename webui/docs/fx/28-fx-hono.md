# fx-hono

Integrates FX server functionality into [Hono](https://hono.dev) applications. Mounts FX's essential server routes (proxy, module loading, health check) and provides middleware for CORS and cross-realm flow execution.

## Quick start

```ts
import { Hono } from 'hono';
import fxHonoPlugin, { setupFXWithHono } from './plugins/fx-hono';

const app = new Hono();

// Option 1: Quick setup
setupFXWithHono(app, fx, { basePath: '/fx' });

// Option 2: Manual setup
const fxHono = fxHonoPlugin(fx, { basePath: '/fx' });
fxHono.mount(app);
```

## Mounted routes

All routes are mounted under the configured `basePath` (default: `/fx`).

| Route | Method | Description |
|-------|--------|-------------|
| `/fx/health` | GET | Returns `{ ok: true, time: "..." }` |
| `/fx/proxy` | ALL | CORS-safe cross-origin API proxy. Pass `?url=<encoded>` |
| `/fx/module` | GET | Module loading proxy. Pass `?url=<encoded>` |
| `/fx` | GET | Info endpoint listing available routes and features |
| `/fx/flow/execute` | POST | Cross-realm flow execution bridge |

### Proxy endpoint

Forwards requests to external URLs, stripping sensitive headers (cookies, origin). Useful for avoiding CORS issues from the browser:

```ts
// Client-side
fetch('/fx/proxy?url=' + encodeURIComponent('https://external-api.com/data'));
```

### Module endpoint

Fetches JavaScript modules from remote URLs and serves them with the correct content type:

```ts
fetch('/fx/module?url=' + encodeURIComponent('https://cdn.example.com/lib.js'));
```

### Flow execution endpoint

Accepts POST requests to execute FX flow nodes on the server. Supports deserializing flows sent from the client:

```json
{
  "flow": "myApp.workflow",
  "node": "processStep",
  "payload": { "data": "..." },
  "serializedFlow": { ... }
}
```

## CORS middleware

Enabled by default. Handles OPTIONS preflight and adds CORS headers to all `/fx/*` responses.

```ts
fxHonoPlugin(fx, {
  corsEnabled: true,
  allowedOrigins: ['https://myapp.com', 'http://localhost:3000']
});
```

## Custom routes

Add your own routes under the FX base path:

```ts
fxHono.addCustomRoutes(app, {
  '/custom': (c, fx) => {
    return { message: 'Hello from custom FX route' };
  },
  '/data/:id': async (c, fx) => {
    const id = c.req.param('id');
    return { id, data: fx.resolvePath(`data.${id}`, fx.root) };
  }
});
```

## Flow middleware

Adds `fx` and `fxHono` to Hono's context for use in downstream handlers:

```ts
app.use('*', fxHono.createFlowMiddleware());

app.get('/my-route', (c) => {
  const fx = c.get('fx');
  // use fx instance
});
```

## Configuration

```ts
interface FXHonoOptions {
  basePath?: string;          // Default: '/fx'
  corsEnabled?: boolean;      // Default: true
  enableProxy?: boolean;      // Default: true
  enableModule?: boolean;     // Default: true
  enableHealth?: boolean;     // Default: true
  allowedOrigins?: string[];  // Default: ['*']
}
```
