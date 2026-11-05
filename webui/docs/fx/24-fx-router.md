# fx-router

SPA routing system for FX. Supports history and hash modes, parameterized routes, guards, page caching, and automatic link interception.

## Quick start

```ts
import routerPlugin from './plugins/fx-router';

const router = routerPlugin(fx, {
  mode: 'history',    // or 'hash'
  target: '#app',     // DOM element to render pages into
  base: '/'
});

router
  .route('/', { template: '/pages/home.html' })
  .route('/users/:id', {
    component: '/components/user-detail.ts',
    guards: ['auth'],
    data: { title: 'User Detail' }
  })
  .route('/error', { template: '/pages/error.html' });
```

## Route definitions

```ts
router.route(path, config)
```

**RouteConfig fields:**

| Field | Type | Description |
|-------|------|-------------|
| `component` | `string` | Module path to load and render |
| `template` | `string` | HTML template URL to fetch |
| `data` | `Record<string, any>` | Initial data for the page's FX node |
| `guards` | `(string \| GuardFunction)[]` | Named or inline guards |
| `meta` | `Record<string, any>` | Arbitrary route metadata |
| `cache` | `boolean` | Cache loaded page (default: `true`) |
| `preload` | `string[]` | URLs to preload when the page loads |

### Path parameters

```ts
router.route('/users/:id', { ... });
// Navigating to /users/42 -> params = { id: '42' }
```

## Navigation

```ts
router.navigate('/users/42');           // push to history
router.navigate('/login', { replace: true }); // replace current entry
router.push('/dashboard');              // alias for navigate
router.replace('/login');               // alias for navigate with replace
router.back();
router.forward();
router.go(-2);
```

Navigation is also available globally:

```ts
$navigate('/dashboard');
$route(); // current route
```

## Guards

Guards run before a page activates. Return `false` (or a resolved `false`) to block navigation.

```ts
// Register a named guard
router.guard('auth', (page, params) => {
  return !!$$('auth.token').val();
});

// Use it
router.route('/admin', {
  guards: ['auth'],
  component: '/pages/admin.ts'
});

// Or use inline guards
router.route('/settings', {
  guards: [(page, params) => isLoggedIn()]
});
```

## Link interception

Internal `<a href="...">` clicks are automatically intercepted and routed through the SPA router. External links (`http://`, `mailto:`, `tel:`) and links with `target="_blank"`, `download`, or `fx-external` attributes are left alone.

## FX integration

The router stores state in the FX tree:

- `router.currentPath` -- current URL path
- `router.currentParams` -- current route parameters
- `pages.<pageKey>` -- page-specific data node

A `fx:navigate` custom event is dispatched on `document` after each navigation, with `{ path, route, params, page }` in `detail`.

## Page lifecycle

Each route creates an `FXPage` internally:

1. **`load()`** -- fetches component/template, preloads dependencies, creates FX node
2. **`activate(params)`** -- runs guards, updates data, renders into target
3. **`deactivate()`** -- removes the page element from the DOM

## Preloading

```ts
await router.preloadRoute('/dashboard');
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `mode` | `'history'` | `'history'` or `'hash'` |
| `target` | `'#app'` | CSS selector for the render target |
| `base` | `'/'` | Base path prefix |
| `caseSensitive` | `false` | Case-sensitive path matching |
| `trailingSlash` | `false` | Allow trailing slashes |
