# FX Selector Engine

The Selector Engine provides CSS-style selectors for querying FX nodes. It supports class, ID, and attribute selectors, pseudo-selectors (`:not()`, `:can()`, `:has()`), and descendant/child combinators.

Available in both Rust and TypeScript with matching APIs.

## Selector Syntax

### Simple Selectors

| Selector | Syntax | Matches |
|---|---|---|
| Class | `.name` | Nodes where `__type` equals `name` or `__proto` contains `name` |
| ID | `#id` | Nodes where `__id` equals `id` |
| Attribute | `[key=value]` | Nodes where an attribute `key` equals `value` |
| Not | `:not(selector)` | Nodes that do NOT match the inner selector |
| Can | `:can(.capability)` | Nodes whose `meta.can` array includes the capability |
| Has | `:has(selector)` | Nodes that have a descendant matching the inner selector |

### Attribute Operators

| Operator | Syntax | Meaning |
|---|---|---|
| Equals | `[key=value]` | Exact match |
| Not equals | `[key!=value]` | Does not equal |
| Prefix | `[key^=value]` | Starts with |
| Suffix | `[key$=value]` | Ends with |
| Contains | `[key*=value]` | Contains substring |

Attribute values can be quoted or unquoted:

```
[role=admin]
[role="admin"]
[name^='user-']
```

### Combinators

| Combinator | Syntax | Meaning |
|---|---|---|
| Descendant | `A B` (space) | `B` is any descendant of `A` |
| Child | `A > B` | `B` is a direct child of `A` |

### Comma-Separated Lists

Multiple selectors can be combined with commas. A node matches if it matches any one of the selectors:

```
.admin, .superuser, [role=owner]
```

## How Matching Works

### `.class` Resolution

A `.class` selector matches a node if:

1. The node's `__type` equals the class name, **or**
2. The node's `__proto` map contains the class name as a key (behavior matching)

```typescript
// TypeScript
const t = node.__type;
const protos = node.__proto ?? new Map();
return t === name || protos.has(name);
```

```rust
// Rust
let node_type = node.get_type();
if node_type.as_deref() == Some(name) { return true; }
node.has_behavior(name)
```

### `#id` Resolution

An `#id` selector matches when `node.__id === id` (TypeScript) or `node.id == id` (Rust).

### `[attr]` Resolution

Attribute values are resolved in a configurable order. The TypeScript version checks these sources in sequence (configurable via `fxCfg('selectors.attrResolution')`):

| Source | What It Checks |
|---|---|
| `meta` | The node's `__meta` object |
| `type` | The type surface (value bag keyed by `__type`) |
| `raw` | The raw value bag of the node |
| `child` | Child nodes by key (reads the child's value) |

The Rust version checks `meta` first, then falls back to child node values:

```rust
// Check meta
let meta = node.meta.read().unwrap();
if let Some(v) = meta.get(key) { return Some(v.to_str()); }
// Check child nodes
node.nodes.get(key).map(|child| child.val().to_str())
```

The resolved value is then compared using the attribute operator.

### `:not()` Resolution

Negates the inner compound selector:

```
:not(.admin)        -- Matches nodes that are NOT of type "admin"
:not([role=guest])  -- Matches nodes where role is not "guest"
```

### `:can()` Resolution

Tests whether a node has a capability listed in `meta.can`:

```
:can(.editable)     -- Matches nodes with "editable" in their can array
```

### `:has()` Resolution

Tests whether any descendant of the node matches the inner selector. In TypeScript, this feature is gated behind `fxCfg('selectors.enableHas', false)`.

```
:has(.error)        -- Matches nodes that contain a descendant of type "error"
```

## API

### parseSelector(input) -> SelList

Parses a selector string into an AST (a list of `SelCompound` values). Comma-separated selectors produce multiple compounds in the list.

```typescript
// TypeScript
import { parseSelector } from "./fx-selector-engine";
const ast = parseSelector(".admin[role=owner], #root > .child");
```

```rust
// Rust
use fx_rust::fx_selector::parse_selector;
let ast = parse_selector(".admin[role=owner], #root > .child");
```

### AST Types

```
SelList = Vec<SelCompound>
SelCompound = { chain: Vec<SelChainPart> }
SelChainPart = Step(SelStep) | Combinator(Descendant | Child)
SelStep = { simple: Vec<SelSimple> }
SelSimple = Class | Id | Attr | Not | Can | Has
```

### matchCompound(node, ast) -> bool

Tests whether a single node matches a compound selector. Matching proceeds right-to-left through the chain, with combinators resolved via parent traversal.

```typescript
// TypeScript
import { matchCompound, parseSelector } from "./fx-selector-engine";
const ast = parseSelector(".admin")[0];
const matches = matchCompound(fx, node, ast);
```

```rust
// Rust
use fx_rust::fx_selector::{parse_selector, match_compound};
let ast = &parse_selector(".admin")[0];
let matches = match_compound(&node, ast);
```

### query(anchor, selectors) -> Vec<Node>

Finds all nodes under `anchor` that match any selector in the list. Traverses the tree depth-first, testing each child node.

```typescript
// TypeScript — use matchCompound manually in a tree walk
const visit = (n: FXNode) => {
    for (const k in n.__nodes) {
        const c = n.__nodes[k];
        if (ast.some(comp => matchCompound(fx, c, comp))) results.push(c);
        visit(c);
    }
};
```

```rust
// Rust
use fx_rust::fx_selector::{parse_selector, query};
let selectors = parse_selector(".active[role=admin]");
let matches = query(&root, &selectors);
for node in &matches {
    println!("Found: {}", node.id);
}
```

## Code Examples

### Find all admin nodes

```rust
let sel = parse_selector(".admin");
let admins = query(&root, &sel);
```

### Find nodes with a specific attribute

```rust
let sel = parse_selector("[role=owner]");
let owners = query(&root, &sel);
```

### Exclude certain types

```rust
let sel = parse_selector(":not(.internal)");
let public_nodes = query(&root, &sel);
```

### Compound selectors

```rust
// Nodes of type "button" with a "disabled" attribute that is not "true"
let sel = parse_selector(".button[disabled!=true]");
let enabled_buttons = query(&root, &sel);
```

### Multiple selectors

```rust
// Match admins OR any node with role=owner
let sel = parse_selector(".admin, [role=owner]");
let privileged = query(&root, &sel);
```
