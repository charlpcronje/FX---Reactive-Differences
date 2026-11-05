# fx-server

FX-native HTTP server framework. Every request, response, route, and middleware is a reactive FX node. Works on both Deno and Node.js.

## Quick start

```ts
import createFXServer from './plugins/fx-server';

const serverFactory = createFXServer(fx);

const server = serverFactory.create({ port: 3000, cors: true });

server.get('/hello', (ctx) => {
  ctx.response.json({ message: 'Hello, world!' });
});

await server.listen(() => console.log('Server running'));
```

### Quick start shortcut

```ts
const server = serverFactory.quickStart(3000, (ctx) => {
  ctx.response.json({ ok: true });
});
await server.listen();
```

## Routing

```ts
server.get('/users', handler);
server.post('/users', handler);
server.put('/users/:id', handler);
server.patch('/users/:id', handler);
server.delete('/users/:id', handler);
server.head('/health', handler);
server.options('/cors', handler);
server.all('/catch-all', handler);    // all HTTP methods

// Generic route method
server.route('/api/data', ['GET', 'POST'], handler1, handler2);
```

### Path parameters

```ts
server.get('/users/:id', (ctx) => {
  const id = ctx.params.val().id;
  ctx.response.json({ userId: id });
});
```

## Context (`FXContext`)

Every request handler receives a context object with FX node proxies:

```ts
interface FXContext {
  request: FXRequest;     // method, url, path, headers, body, query, params, cookies, ip
  response: FXResponse;   // status(), json(), text(), html(), redirect(), cookie(), send()
  params: FXNodeProxy;    // route parameters
  query: FXNodeProxy;     // query string parameters
  state: FXNodeProxy;     // per-request state (shared across middleware)
  next: () => Promise<void>;
}
```

### Request

```ts
ctx.request.method.val();     // 'GET'
ctx.request.path.val();       // '/users/42'
ctx.request.body.val();       // parsed body
ctx.request.headers.get('content-type').val();
```

### Response

```ts
ctx.response.status(201).json({ id: 1, name: 'Alice' });
ctx.response.text('Hello');
ctx.response.html('<h1>Hi</h1>');
ctx.response.redirect('/login', 302);
ctx.response.cookie('session', 'abc123', { httpOnly: true, maxAge: 3600 });
```

## Middleware

```ts
server.use(async (ctx) => {
  const start = Date.now();
  await ctx.next();
  console.log(`${ctx.request.method.val()} ${ctx.request.path.val()} - ${Date.now() - start}ms`);
});
```

### Built-in middleware

These are added automatically based on config:

- **CORS** -- enabled via `cors: true` or `cors: { origin, methods, headers, credentials, maxAge }`
- **Body parser** -- parses JSON, form-urlencoded, and multipart bodies
- **Query parser** -- parses URL query parameters

## Static file serving

```ts
server.static('/assets', './public');
```

## WebSocket support

```ts
server.ws('/live', (ws) => {
  ws.on('message', (msg) => { /* handle */ });
});
```

## Router (route grouping)

```ts
import { Router } from './plugins/fx-server';

const api = new Router('/api/v1');
api.get('/users', listUsers);
api.post('/users', createUser);
api.mount(server);
```

## Response helpers

```ts
import { responses } from './plugins/fx-server';

server.get('/ok', (ctx) => ctx.response.json(responses.ok({ items: [] })));
server.get('/fail', (ctx) => ctx.response.status(404).json(responses.notFound('User not found')));
```

Available helpers: `ok`, `created`, `accepted`, `noContent`, `badRequest`, `unauthorized`, `forbidden`, `notFound`, `serverError`.

## FX integration

Server state is tracked in the FX tree:

- `server.status` -- `'running'` or `'stopped'`
- `server.port`, `server.host`
- `server.routes` -- registered routes
- `server.stats` -- `{ requests, errors, avgResponseTime, activeConnections }`

## Configuration

```ts
interface ServerConfig {
  port: number;
  host?: string;              // default: 'localhost'
  cors?: boolean | CorsOptions;
  compress?: boolean;
  maxBodySize?: number;
  timeout?: number;
  staticDir?: string;
  staticPrefix?: string;
}
```
