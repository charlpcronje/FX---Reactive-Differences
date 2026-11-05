# FX Groups

Groups are reactive collections of FX nodes. They combine manual membership control, CSS selector-based inclusion/exclusion, type filtering, custom predicates, and aggregate operations into a single composable API.

Available in both Rust and TypeScript with matching semantics.

## Creating a Group

```typescript
// TypeScript
const group = new Group(fx, anchorNode);
group.initSelection();
```

```rust
// Rust
let group = Group::new(root.clone(), anchor.clone(), logger.clone());
group.init_selection();
```

The `anchor` node defines the subtree that the group scans. The `root` (Rust) or `fx` (TypeScript) provides the full tree for ID lookups.

## Manual Membership

Groups support ordered membership with precise insertion control. All methods return `self` for chaining.

| Method | Description |
|---|---|
| `add(node)` | Append a node to the end |
| `prepend(node)` | Insert a node at the beginning |
| `insert(index, node)` | Insert at a specific index |
| `addBefore(existing, target)` | Insert `target` before `existing` |
| `addAfter(existing, target)` | Insert `target` after `existing` |
| `remove(node)` | Remove a node |
| `clear()` | Remove all members |

Duplicate additions are silently ignored (based on node ID).

```typescript
// TypeScript
group
    .add(nodeA)
    .add(nodeB)
    .addAfter(nodeA, nodeC)  // A, C, B
    .prepend(nodeD);          // D, A, C, B
```

```rust
// Rust
group
    .add(node_a.clone())
    .add(node_b.clone())
    .add_after(&node_a, node_c.clone())
    .prepend(node_d.clone());
```

In TypeScript, `add()` also accepts path strings and FXNodeProxy objects, which are resolved automatically.

### Predicate-Based Removal (TypeScript)

The TypeScript version supports removing members by predicate:

```typescript
group.remove(p => p.val() < 10);
```

## CSS Selector Include/Exclude

Use CSS selectors to dynamically determine group membership. Included nodes are added; excluded nodes are filtered out. Manually added nodes take priority and appear first.

```typescript
// TypeScript
group.selectCss(".active");
group.excludeCss(".hidden");
```

```rust
// Rust
group.select_css(".active");
group.exclude_css(".hidden");
```

Selectors use the [FX Selector Engine](16-fx-selector-engine.md). Multiple include and exclude selectors can be stacked.

```rust
group.select_css(".button");
group.select_css("[role=action]");
group.exclude_css(".disabled");
```

Clear selectors to reset:

```rust
group.clear_selectors();  // Rust
```

```typescript
group.clearSelectors("include");   // Clear only include selectors
group.clearSelectors("exclude");   // Clear only exclude selectors
group.clearSelectors("all");       // Clear both (default)
```

## Type Filtering with byType()

Filter members by their `__type` value:

```typescript
// TypeScript -- pass one or more type names
group.byType("admin", "superuser");
```

```rust
// Rust
group.by_type(&["admin", "superuser"]);
```

Only nodes whose `__type` matches one of the given types are included.

## Custom Predicates with where()

Apply a custom filter function. Receives an FXNodeProxy for each candidate node:

```typescript
// TypeScript
group.where(p => p.val() > 10);
```

```rust
// Rust
group.where_fn(|proxy| proxy.num() > 10.0);
```

## Deep Scan Mode

By default, groups scan only direct children of the anchor node. Enable deep scan to recursively include descendants:

```typescript
group.deep();       // TypeScript (default: true)
group.deep(false);  // Disable
```

```rust
group.deep(true);   // Rust
group.deep(false);
```

## List Mode vs Set Mode

| Mode | Behavior |
|---|---|
| **List** (default) | Members are ordered; duplicates preserved in insertion order |
| **Set** | Deduplicates members by node identity |

```typescript
group.modeSet();   // TypeScript
group.modeList();
```

```rust
group.mode_set();  // Rust
group.mode_list();
```

## Reading Members

```typescript
// TypeScript
const proxies = group.list();     // FXNodeProxy[]
const values  = group.values();   // raw values
const count   = group.list().length;
```

```rust
// Rust
let proxies = group.list();       // Vec<FXProxy>
let values  = group.values();     // Vec<FXValue>
let count   = group.len();
let empty   = group.is_empty();
```

## Aggregate Operations

Groups provide built-in aggregates that operate on member values:

| Method | Returns | Description |
|---|---|---|
| `sum()` | `f64` | Sum of all member values (as numbers) |
| `min()` | `f64` | Minimum value |
| `max()` | `f64` | Maximum value |
| `average()` | `f64` | Arithmetic mean (returns `NaN` if empty) |
| `concat(sep)` | `String` | Join all values as strings with a separator |
| `sort(dir)` | `Vec<FXValue>` | Sort values (`"asc"` or `"desc"`) |

```rust
// Rust
group.add(node_a).add(node_b).add(node_c);  // values: 10, 20, 30

group.sum();              // 60.0
group.min();              // 10.0
group.max();              // 30.0
group.average();          // 20.0
group.concat(", ");       // "10, 20, 30"
group.sort_values(true);  // [10, 20, 30]  (ascending)
```

```typescript
// TypeScript
group.sum();              // 60
group.min();              // 10
group.max();              // 30
group.average();          // 20
group.concat(", ");       // "10, 20, 30"
group.sort("desc");       // [30, 20, 10]
group.cast("number");     // [10, 20, 30] as number[]
```

## Uniformity Checks

### same_value() / same("value")

Returns `true` if all members have the same value (compared as strings):

```rust
group.same_value()   // Rust
```

```typescript
group.same("value")  // TypeScript
```

### same_type() / same("type")

Returns `true` if all members have the same `__type`:

```rust
group.same_type()    // Rust
```

```typescript
group.same("type")   // TypeScript
```

### has_value(v) / has(v)

Returns `true` if any member's value matches:

```rust
group.has_value(&FXValue::from(42))   // Rust
```

```typescript
group.has(42)   // TypeScript
```

## Reactive Mode

In reactive mode, the group automatically reconciles its membership when the underlying tree structure changes. Reconciliation is debounced to avoid thrashing.

```typescript
// TypeScript (reactive by default, configurable via fxCfg)
group.reactiveMode(true);
group.debounce(50);  // 50ms debounce
```

```rust
// Rust -- reactive defaults to true, debounce defaults to 20ms
```

When a structural change occurs within the anchor's subtree, the group schedules a reconciliation that:

1. Re-runs selectors and filters
2. Compares the new member set against the current set
3. Emits a `"change"` event if the membership changed

The reconciliation guard (`_reconciling` flag) prevents infinite loops when watch subscriptions themselves trigger structural events.

## Events

Subscribe to group events:

```typescript
// TypeScript
const off = group.on("change", (g) => {
    console.log("Group now has", g.list().length, "members");
});

// Unsubscribe
off();
```

```rust
// Rust
group.on("change", |g| {
    println!("Group now has {} members", g.len());
});
```

The `"change"` event fires whenever membership changes (adds, removes, reconciliation) or when a member's value changes (via per-node watch subscriptions in TypeScript).

### Conditional Event Handlers (TypeScript)

The TypeScript version supports object-based handlers for conditional events:

```typescript
// Fire when the group contains a specific value
group.on("has", { value: 42, callback: (g) => console.log("Found 42!") });

// Fire when the average crosses a threshold
group.on("average", {
    greaterThan: 100,
    callback: (g, avg) => console.log("Average exceeded 100:", avg)
});
```

## Complete Example

```rust
let root = Arc::new(FXNode::new("root".into(), logger.clone()));

// Create some typed nodes with values
let a = root.get_or_create_child("a");
a.set_type(Some("metric".into()));
a.set(FXValue::from(10), &mut 0);

let b = root.get_or_create_child("b");
b.set_type(Some("metric".into()));
b.set(FXValue::from(20), &mut 0);

let c = root.get_or_create_child("c");
c.set_type(Some("label".into()));
c.set(FXValue::from("hello"), &mut 0);

// Create a group of metric nodes
let group = Group::new(root.clone(), root.clone(), logger);
group.by_type(&["metric"]);

assert_eq!(group.len(), 2);
assert_eq!(group.sum(), 30.0);
assert_eq!(group.average(), 15.0);
assert!(group.same_type());

// Listen for changes
group.on("change", |g| {
    println!("Metrics total: {}", g.sum());
});
```
