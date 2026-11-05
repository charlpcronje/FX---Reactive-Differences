# FX Atomics Plugin

**Plugin name:** `atomics`
**Version:** 2.0.0

FX Atomics provides bi-directional (or one-way) entanglement between FX nodes. When two nodes are entangled, a change to one automatically propagates to the other. This is the reactive glue for variable binding, parameter passing, and cross-component state synchronization.

---

## Core Concept

Entanglement links two FX node paths so that changes propagate between them. The plugin listens for `StructureEvent::ValueChanged` events on the FX tree and, when a linked path changes, applies the new value to its partner.

```
  path.a ---- entangle ----> path.b
         <--- entangle ----
```

Key properties:
- **Re-entrancy guard** prevents infinite ping-pong: when A changes and updates B, the guard ensures B's change does not trigger a write back to A within the same propagation.
- **Equality check** skips propagation if the value has not actually changed.
- **Lifecycle controls** let you pause, resume, or permanently dispose a link.

---

## EntangleOptions

| Field | Type | Default | Description |
|---|---|---|---|
| `bidirectional` | `bool` | `true` | Sync changes in both directions (A to B and B to A). |
| `one_way_a_to_b` | `bool` | `false` | Only propagate from A to B. |
| `one_way_b_to_a` | `bool` | `false` | Only propagate from B to A. |
| `sync_initial` | `bool` | `true` | Copy A's current value to B when the link is created. |
| `map_a_to_b` | `TransformFn \| None` | `None` | Transform the value before writing to B. |
| `map_b_to_a` | `TransformFn \| None` | `None` | Transform the value before writing to A. |
| `before_set_a` | `BeforeSetHook \| None` | `None` | Hook called before writing to A. Return `Some(value)` to proceed, `None` to skip. |
| `before_set_b` | `BeforeSetHook \| None` | `None` | Hook called before writing to B. Return `Some(value)` to proceed, `None` to skip. |
| `after_set_a` | `AfterSetHook \| None` | `None` | Hook called after writing to A. |
| `after_set_b` | `AfterSetHook \| None` | `None` | Hook called after writing to B. |
| `label` | `String \| None` | `None` | Debug label for identifying the link in logs and observability. |

---

## entangle()

Create a link between two FX node paths. Returns an `AtomicLink` handle for lifecycle control.

```rust
// Rust -- bi-directional (default)
let link = atomics.entangle("app.title", "ui.header.text", EntangleOptions::default());

// Setting either side propagates to the other
fx.proxy("app.title").val_set("Hello");
// fx.proxy("ui.header.text") is now "Hello"

fx.proxy("ui.header.text").val_set("World");
// fx.proxy("app.title") is now "World"
```

### One-way binding

Use `one_way_a_to_b` for source-to-target reactive bindings where the target should never write back.

```rust
// Rust -- one-way: source drives target
let link = atomics.entangle("xml.title", "xslt.vars.title", EntangleOptions {
    one_way_a_to_b: true,
    ..Default::default()
});

// xml.title changes propagate to xslt.vars.title
// xslt.vars.title changes do NOT propagate back
```

### With transform

Transform functions let you map values during propagation. This is useful for unit conversion, formatting, or type coercion.

```rust
// Rust -- currency conversion
let link = atomics.entangle("price.usd", "price.eur", EntangleOptions {
    one_way_a_to_b: true,
    map_a_to_b: Some(Arc::new(|v| {
        FXValue::Number(v.to_num() * 0.85)
    })),
    ..Default::default()
});

fx.proxy("price.usd").val_set(100.0);
// price.eur is now 85.0
```

### With hooks

Hooks provide interception points for validation, logging, or conditional updates.

```rust
// Rust -- validate before setting, log after
let link = atomics.entangle("source", "target", EntangleOptions {
    before_set_b: Some(Arc::new(|old, new| {
        // Only allow non-null values
        if new.is_null() {
            None  // skip the update
        } else {
            Some(new.clone())  // allow
        }
    })),
    after_set_b: Some(Arc::new(|value| {
        println!("Target updated to: {:?}", value);
    })),
    ..Default::default()
});
```

---

## Pause / Resume / Dispose

Every `entangle()` call returns an `AtomicLink` with lifecycle controls.

| Method | Description |
|---|---|
| `link.pause()` | Temporarily stop propagation. Changes to linked paths are ignored while paused. |
| `link.resume()` | Resume propagation. |
| `link.dispose()` | Permanently disconnect the link. Cannot be resumed. |
| `link.is_paused()` | Returns `true` if currently paused. |
| `link.is_disposed()` | Returns `true` if permanently disposed. |

```rust
let link = atomics.entangle("a", "b", EntangleOptions::default());

// Temporarily pause during bulk updates
link.pause();
fx.proxy("a").val_set(1.0);  // does NOT propagate to b
fx.proxy("a").val_set(2.0);  // does NOT propagate to b
link.resume();

// Permanently disconnect
link.dispose();
fx.proxy("a").val_set(3.0);  // does NOT propagate to b (ever again)
```

---

## Re-entrancy Guard

The re-entrancy guard is a critical safety mechanism. Without it, a bi-directional link would cause infinite recursion:

1. A changes -> propagate to B
2. B changes -> propagate to A
3. A changes -> propagate to B
4. (forever)

The guard works by setting a `propagating` flag before writing to the partner node. While this flag is set, any change events for this link are ignored. The flag is cleared after the write completes.

This is entirely automatic. You do not need to manage it.

---

## Observability

Link metadata is stored in the FX tree for inspection:

```
atomics.links.<id>.path_a    -- first linked path
atomics.links.<id>.path_b    -- second linked path
atomics.links.<id>.active    -- whether the link is active
atomics.links.<id>.label     -- debug label
atomics.stats.total_links    -- total links created
atomics.stats.propagations   -- total value propagations
```

---

## Use Cases

### Variable binding (XSLT)

One-way entanglement binds XML source values to XSLT variables. When the source document changes, XSLT variables update automatically.

```rust
atomics.entangle("xml.doc.title", "xslt.vars.documentTitle", EntangleOptions {
    one_way_a_to_b: true,
    label: Some("xml-title-binding".to_string()),
    ..Default::default()
});
```

### Parameter passing between components

Bi-directional entanglement keeps two components in sync, such as a form input and its backing model.

```rust
atomics.entangle("form.name.value", "model.user.name", EntangleOptions::default());
```

### Derived values with transforms

Compute derived state that stays in sync with its source.

```rust
// Full name derived from first + last
atomics.entangle("model.firstName", "display.fullName", EntangleOptions {
    one_way_a_to_b: true,
    map_a_to_b: Some(Arc::new(|first| {
        // In practice you'd also read lastName
        FXValue::String(Arc::from(format!("{} (pending)", first.to_str())))
    })),
    ..Default::default()
});
```

### Context synchronization

Keep state in sync across different parts of the FX tree, such as a global theme setting reflected in multiple UI subtrees.

```rust
atomics.entangle("settings.theme", "ui.sidebar.theme", EntangleOptions::default());
atomics.entangle("settings.theme", "ui.editor.theme", EntangleOptions::default());
```
