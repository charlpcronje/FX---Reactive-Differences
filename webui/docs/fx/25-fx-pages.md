# fx-pages

Layout and nested routing layer that sits on top of `fx-router`. Provides named layouts with slot-based rendering, breadcrumb tracking, and page lifecycle integration.

## Quick start

```ts
import FXPagesPlugin from './plugins/fx-pages';

const pages = new FXPagesPlugin(fx, { defaultLayout: 'default' });
```

## Layouts

A layout is a template with named slots where page content is injected.

```ts
// Register a custom layout
pages.layout('dashboard', {
  template: `
    <div class="dashboard">
      <nav>{{slot:sidebar}}</nav>
      <main>{{slot:main}}</main>
    </div>
  `,
  data: { appName: 'MyApp' },
  cache: true
});
```

**LayoutConfig fields:**

| Field | Type | Description |
|-------|------|-------------|
| `template` | `string` | HTML template with `{{slot:name}}` placeholders |
| `component` | `string` | Alternative: module path for a component that renders the layout |
| `slots` | `Record<string, string>` | Named slot defaults |
| `data` | `Record<string, any>` | Data available to the layout template |
| `cache` | `boolean` | Cache the loaded layout (default: `true`) |

### Default layout

A built-in `default` layout is registered automatically:

```html
<div class="fx-app">
  <header>{{slot:header}}</header>
  <main>{{slot:main}}</main>
  <footer>{{slot:footer}}</footer>
</div>
```

### Accessing slots

```ts
const mainSlot = pages.slot('main');    // HTMLElement for the 'main' slot
const sidebar  = pages.slot('sidebar'); // HTMLElement for 'sidebar'
```

## Pages

Pages integrate with `fx-router` to assign layouts and track breadcrumbs.

```ts
pages.page('/dashboard', {
  layout: 'dashboard',
  component: '/pages/dashboard.ts',
  breadcrumb: 'Dashboard',
  layoutData: { activeNav: 'home' }
});

pages.page('/settings', {
  layout: 'dashboard',
  template: '/pages/settings.html',
  breadcrumb: { title: 'Settings' },
  nested: true,
  data: { section: 'general' }
});
```

**PageConfig fields:**

| Field | Type | Description |
|-------|------|-------------|
| `layout` | `string` | Layout name to use (falls back to default) |
| `template` | `string` | HTML template URL |
| `component` | `string` | Module path |
| `breadcrumb` | `string \| { title: string }` | Breadcrumb entry |
| `nested` | `boolean` | Whether this is a nested route |
| `layoutData` | `Record<string, any>` | Data merged into the layout |
| `data` | `Record<string, any>` | Page-specific data |

## Breadcrumbs

Breadcrumbs are automatically tracked and stored in the FX tree at `pages.breadcrumbs`:

```ts
const crumbs = $$('pages.breadcrumbs').val();
// [{ path: '/dashboard', title: 'Dashboard', timestamp: ... }, ...]
```

The breadcrumb history is capped at 10 entries.

## Layout activation

```ts
await pages.activateLayout('dashboard', { activeNav: 'settings' });
```

This renders the layout into `#app` (or `document.body`) and makes its slots available.

## How it works

When a page is navigated to via `fx-router`, the pages plugin:

1. Activates the page's layout (renders it if not already active)
2. Records a breadcrumb entry
3. Lets the router handle the actual page content rendering into the layout's slots
