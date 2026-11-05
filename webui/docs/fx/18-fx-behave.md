# FX Behavioral Nodes

Behavioral Nodes are an executable node graph DSL built entirely on pure JSON. No closures are stored. Any language that can evaluate safe expressions can run these nodes.

The system provides 11 primitive types that compose into class-like behavior, plus `class` and `instance` as structural wrappers.

## Node Types

### Data Nodes

| Type | Purpose | Key Fields |
|---|---|---|
| `value` | Holds a scalar value | `__default`, `__schema`, `__value` |
| `ref` | References a value by path in the context | `__ref` |

### Control Nodes

| Type | Purpose | Key Fields |
|---|---|---|
| `guard` | Gates execution -- returns a boolean | `__expr` |
| `pick` | Selects the first branch whose expression is truthy | `__nodes` (branches, each with `__expr`) |
| `seq` | Executes children in order, threading the result | `__nodes` (keyed children, sorted by key) |
| `each` | Iterates over an array, running a body per item | `__expr` (source), `__nodes` (body) |
| `trap` | Try/catch wrapper around child execution | `__nodes` (body + `catch` key) |

### Compute Nodes

| Type | Purpose | Key Fields |
|---|---|---|
| `map` | Evaluates an expression, defaulting to the current result | `__expr` |
| `expr` | Evaluates an expression (pure computation) | `__expr` |

### Event Nodes

| Type | Purpose | Key Fields |
|---|---|---|
| `emit` | Fires an event on the bus with an optional payload | `__event`, `__payload` |
| `when` | Registers a handler for an event | `__event` or `__watch`, `__nodes` (body) |

### Structural Types

| Type | Purpose | Key Fields |
|---|---|---|
| `class` | Template for instantiation | `__nodes` (members), `__meta.name` |
| `instance` | A materialized class | `__nodes` (members), `__meta.__class` |

## BehaveNode Structure

Every behavioral node serializes to JSON with double-underscore-prefixed fields:

```json
{
    "__type": "guard",
    "__expr": "self.age > 18",
    "__nodes": { ... },
    "__meta": { "name": "AgeCheck" }
}
```

| Field | Used By | Description |
|---|---|---|
| `__type` | All | One of the 13 node types |
| `__expr` | guard, map, expr, each | Expression to evaluate |
| `__event` | emit, when | Event name |
| `__payload` | emit | Payload expression |
| `__watch` | when | Path to watch (alternative to `__event`) |
| `__ref` | ref | Context path to dereference |
| `__default` | value | Default value |
| `__schema` | value | Type hint: `"string"`, `"number"`, `"boolean"`, `"any"` |
| `__nodes` | seq, pick, each, trap, when, class, instance | Child nodes |
| `__value` | value, instance | Current value |
| `__meta` | any | Arbitrary metadata |

## BehaveContext

The context object provides data to expressions during execution:

| Field | Type | Description |
|---|---|---|
| `self` | `HashMap<String, FXValue>` | Current instance's sibling values |
| `args` | `FXValue` | Arguments passed to the current call |
| `root` | `HashMap<String, FXValue>` | Global FX tree access (flattened) |
| `result` | `Option<FXValue>` | Return value accumulator (threaded through `seq`) |
| `event` | `Option<String>` | Last emitted event name |
| `error` | `Option<String>` | Caught error string |

```rust
let ctx = BehaveContext::new()
    .with_args(FXValue::from(42))
    .with_self(instance_data)
    .with_root(global_data);
```

## SafeExpr Evaluator

Expressions are evaluated by a safe, sandboxed evaluator that handles the most common patterns without arbitrary code execution.

### Supported Operations

| Category | Examples |
|---|---|
| Literals | `42`, `3.14`, `"hello"`, `true`, `false`, `null` |
| Property access | `self.name`, `args.x`, `root.config`, `result` |
| Arithmetic | `self.x + 10`, `args.price * args.qty`, `self.a - self.b` |
| Comparisons | `self.age > 18`, `args.name == "admin"`, `self.count >= 5` |
| Equality | `==`, `!=`, `===`, `!==` |
| Relational | `>`, `<`, `>=`, `<=` |
| Logical | `self.active && self.verified`, `self.admin \|\| self.owner` |
| Negation | `!self.disabled` |

### Path Resolution

| Prefix | Resolves To |
|---|---|
| `self.x` | Instance field `x` |
| `args` | Full args value |
| `args.x` | Field `x` of args (if args is an object) |
| `root.x` | Global tree field `x` |
| `result` | Current result accumulator |

## BehaveExecutor

The executor runs behavioral nodes against a context:

```rust
let executor = BehaveExecutor::new();
let result = executor.run(&node, &ctx);
```

### How Each Type Executes

#### value

Returns `__value` if set, otherwise `__default`, otherwise `Null`.

#### ref

Resolves `__ref` as a path in the context (e.g., `"self.name"` returns the value of `self.name`).

#### guard

Evaluates `__expr` and returns a boolean. When used inside a `seq`, a falsy guard aborts the entire sequence (returns `Null`).

```rust
let node = BehaveNode::new_guard("self.age > 18");
// Returns FXValue::Bool(true) or FXValue::Bool(false)
```

#### seq

Executes children **in key order** (keys are sorted, numeric keys sort numerically). The initial `result` is set to `args`. Each child receives the previous child's output as `result` in its context.

If a child is a `guard` and evaluates to `false`, the sequence aborts immediately and returns `Null`.

```json
{
    "__type": "seq",
    "__nodes": {
        "0": { "__type": "guard", "__expr": "self.active" },
        "1": { "__type": "expr", "__expr": "self.balance + args" },
        "2": { "__type": "map", "__expr": "result * 1.1" }
    }
}
```

#### pick

Evaluates each branch's `__expr` in order. The first branch that evaluates to truthy has its `__nodes` executed as a sequence. If no branch matches, returns `Null`.

```json
{
    "__type": "pick",
    "__nodes": {
        "high": { "__type": "guard", "__expr": "self.priority > 8", "__nodes": { ... } },
        "low":  { "__type": "guard", "__expr": "self.priority <= 8", "__nodes": { ... } }
    }
}
```

#### each

Evaluates `__expr` to get a source array (or uses `args` as the source). Runs the body sequence for each item, injecting `self.__item` and `self.__index` into the context. Returns an array of results.

```json
{
    "__type": "each",
    "__expr": "self.items",
    "__nodes": {
        "0": { "__type": "expr", "__expr": "self.__item * 2" }
    }
}
```

#### map

Evaluates `__expr` and returns the result. If no expression is provided, returns the current `result`.

#### expr

Evaluates `__expr` and returns the result.

#### trap

Executes child nodes (excluding the `catch` key) in key order. In Rust, error handling is limited; in TypeScript, errors caught during execution route to the `catch` branch.

#### emit

Fires an event on the executor's event bus. Evaluates `__payload` (or uses `result`) as the payload.

```json
{
    "__type": "emit",
    "__event": "order.completed",
    "__payload": "self.orderId"
}
```

#### when

Registers a handler on the event bus. When the named event fires, the `__nodes` body executes as a sequence with the event payload as `args`.

```json
{
    "__type": "when",
    "__event": "order.completed",
    "__nodes": {
        "0": { "__type": "expr", "__expr": "args" }
    }
}
```

## The Event Bus

The executor has a built-in event bus. `emit` nodes publish events; `when` nodes subscribe to them.

```rust
let executor = BehaveExecutor::new();

// Manual subscription
executor.on("order.completed", |payload, ctx| {
    println!("Order completed: {:?}", payload);
});

// Or use when nodes -- they self-register on run()
executor.run(&when_node, &ctx);

// Emit fires all registered handlers
executor.run(&emit_node, &ctx);
```

## Class and Instance

Classes are templates. Instances are materialized copies with live state.

### Defining a Class

```rust
let mut members = HashMap::new();
members.insert("name".into(),
    BehaveNode::new_value(Some(FXValue::from("default")), Some("string".into())));
members.insert("age".into(),
    BehaveNode::new_value(Some(FXValue::from(0)), Some("number".into())));
members.insert("greet".into(), {
    let mut body = HashMap::new();
    body.insert("0".into(), BehaveNode::new_expr("self.name"));
    BehaveNode::new_seq(body)
});

let person_class = BehaveNode::new_class("Person", members);
```

Equivalent JSON:

```json
{
    "__type": "class",
    "__meta": { "name": "Person" },
    "__nodes": {
        "name": { "__type": "value", "__default": "default", "__schema": "string" },
        "age":  { "__type": "value", "__default": 0, "__schema": "number" },
        "greet": {
            "__type": "seq",
            "__nodes": {
                "0": { "__type": "expr", "__expr": "self.name" }
            }
        }
    }
}
```

### Instantiation

```rust
let executor = BehaveExecutor::new();

let mut init = HashMap::new();
init.insert("name".into(), FXValue::from("Alice"));
init.insert("age".into(), FXValue::from(30));

let instance = executor.instantiate(&person_class, Some(&init));
```

`instantiate()` copies value nodes (applying init overrides or defaults) and shares method/computed nodes from the class definition. The instance's `__meta.__class` records the originating class name.

### Calling Methods

```rust
let result = executor.call_method(&mut instance, "greet", FXValue::Null);
// result = FXValue::String("Alice")
```

`call_method()`:
1. Builds `self_data` from the instance's value and ref nodes
2. Creates a context with `self_data` and the provided `args`
3. Runs the method node
4. Writes back any mutations to value nodes

## expand() and wrap() -- Serialization

`expand()` converts a `BehaveNode` into an `FXValue` tree for storage or transmission:

```rust
let expanded: FXValue = expand(&guard_node);
// FXValue::Object({ "__type": "guard", "__expr": "self.x > 10" })
```

`wrap()` converts an `FXValue` tree back into a `BehaveNode`:

```rust
let node: Option<BehaveNode> = wrap(&expanded);
```

These form a lossless roundtrip:

```rust
let node = BehaveNode::new_guard("self.x > 10");
let expanded = expand(&node);
let restored = wrap(&expanded).unwrap();
assert_eq!(restored.node_type, NodeType::Guard);
assert_eq!(restored.expr.as_deref(), Some("self.x > 10"));
```

Since `BehaveNode` derives `Serialize` and `Deserialize`, you can also use serde directly:

```rust
let json = serde_json::to_string(&class)?;
let deserialized: BehaveNode = serde_json::from_str(&json)?;
```

## Complete Example: Counter Class

```rust
let executor = BehaveExecutor::new();

// Define a Counter class
let mut members = HashMap::new();

members.insert("count".into(),
    BehaveNode::new_value(Some(FXValue::from(0)), Some("number".into())));

// increment method: guard (count < 100), then count + 1
members.insert("increment".into(), {
    let mut steps = HashMap::new();
    steps.insert("0".into(), BehaveNode::new_guard("self.count < 100"));
    steps.insert("1".into(), BehaveNode::new_expr("self.count + 1"));
    BehaveNode::new_seq(steps)
});

// reset method
members.insert("reset".into(), BehaveNode::new_expr("0"));

let counter_class = BehaveNode::new_class("Counter", members);

// Instantiate
let mut counter = executor.instantiate(&counter_class, None);

// Call methods
let result = executor.call_method(&mut counter, "increment", FXValue::Null);
// result = 1.0

let result = executor.call_method(&mut counter, "increment", FXValue::Null);
// result = 2.0

let result = executor.call_method(&mut counter, "reset", FXValue::Null);
// result = 0.0
```
