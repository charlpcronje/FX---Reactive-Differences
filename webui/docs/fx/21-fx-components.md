# fx-components

Declarative component system for FX. Load `.fxc` files containing YAML metadata, HTML templates, scoped CSS, and script sections. Components are parsed, XSLT-transformed, hydrated into the DOM, and reactively bound to FX nodes.

## Quick start

```ts
import componentsPlugin from './plugins/fx-components';
const components = componentsPlugin(fx, { componentsPath: '/components' });

// Load and render
const { instance, element } = await components.loadAndHydrate(
  '/components/counter.fxc',
  'app.counter',
  document.getElementById('root')
);
```

Or use the custom element directly in HTML:

```html
<fx-component src="/components/counter.fxc" fx-path="app.counter"></fx-component>
```

## .fxc file format

```yaml
---
name: counter
element: my-counter
scoped: true
fx:
  count: 0
---
--- template
<div class="counter">
  <fx-text path="count"/>
  <button fx-on-click="increment">+</button>
</div>
--- style
.counter { display: flex; gap: 8px; }
button { cursor: pointer; }
--- script
const increment = () => {
  const current = node.val()?.count || 0;
  node.set({ count: current + 1 });
};
```

### Sections

| Section | Purpose |
|---------|---------|
| YAML frontmatter (`---...---`) | Component metadata: `name`, `element` tag, `scoped` CSS flag, initial `fx` data |
| `template` | HTML with FX directives and `{{path}}` interpolation |
| `style` | CSS (auto-scoped to the component by default) |
| `script` | JS executed with `fx`, `node`, `element`, `component`, and `console` in scope |

## Template directives

### `{{path}}` interpolation

Resolves dot-paths against the component's FX node data. Values are HTML-escaped.

```html
<span>Hello, {{user.name}}</span>
```

### `<fx-text path="...">`

Transformed via XSLT into a `<span fx-bind="..." fx-type="text">` that reactively updates when the FX node changes.

### `<fx-if test="...">`

Conditionally shows/hides content. The `test` expression is evaluated against the component's FX data.

```html
<fx-if test="count > 0">
  <p>Count is positive</p>
</fx-if>
```

### `<fx-each path="...">`

Iterates over an array at the given path.

## Key classes

### FXCParser

Parses `.fxc` file content into an `FXComponent` object.

```ts
const parser = new FXCParser();
const component = parser.parse(fxcContent, '/components/counter.fxc');
// component.metadata, component.sections, component.dependencies
```

Also performs XSLT transformation on templates (`transformTemplate()`).

### FXComponentInstance

Manages a live component instance:

- **`hydrate(element?)`** -- renders template, applies scoped styles, sets up bindings and event listeners
- **`destroy()`** -- removes bindings, event listeners, child components, and DOM element

### FXComponents (main class)

| Method | Description |
|--------|-------------|
| `load(url)` | Fetch and parse a `.fxc` file (cached) |
| `create(url, fxPath, element?)` | Load + create instance at the given FX path |
| `loadAndHydrate(url, fxPath, element?)` | Load + create + hydrate in one call |
| `getInstance(fxPath)` | Get a live instance by its FX path |
| `destroyInstance(fxPath)` | Destroy and unregister an instance |
| `getRegistry()` | List registered components and instances |
| `clearCache()` | Clear the component definition cache |

## Binding types

Elements with `fx-bind` are reactively updated. The `fx-type` attribute controls how:

| `fx-type` | Effect |
|-----------|--------|
| `text` | Sets `textContent` |
| `html` | Sets `innerHTML` |
| `attr` | Sets attribute named by `fx-attr` |
| `class` | Sets `className` |
| `style` | Sets `style.cssText` |

## Events

Use `fx-on-<event>` attributes to wire DOM events to script actions:

```html
<button fx-on-click="handleSave">Save</button>
```

## Configuration

```ts
componentsPlugin(fx, {
  componentsPath: '/components',  // base path for component files
  autoLoadEnabled: true,          // auto-load from <fx-component> elements
  cacheEnabled: true              // cache parsed component definitions
});
```

## Globals

- `$components` -- the `FXComponents` instance
- `$loadComponent(url, fxPath, element?)` -- shortcut for `loadAndHydrate`
