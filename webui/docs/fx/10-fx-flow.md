# FX Flow Plugin

**Plugin name:** `flow`
**Version:** 1.0.0

FX Flow provides dynamic reactive flow graphs with BFS/DFS scheduling, event-driven execution, guards, branching, and retry logic. Flows are defined as directed graphs of nodes, where each node has an effect (the work it performs), optional guards and branches, and connections to downstream nodes. A queue-based pump processes nodes until the queue is empty or a budget is exceeded.

FX Flow is the execution engine behind XSLT processing in FX, where BFS scheduling eliminates recursion while preserving correct template evaluation order.

---

## FlowConfig

Configure flow behavior at the plugin level.

| Property | Type | Default | Description |
|---|---|---|---|
| `order` | `"bfs"` \| `"dfs"` | `"bfs"` | Scheduling order. BFS uses FIFO (breadth-first), DFS uses LIFO (depth-first). |
| `max_steps` | `number \| null` | `null` | Maximum node executions before the pump stops. `null` means unlimited. |
| `max_millis` | `number \| null` | `null` | Maximum wall-clock milliseconds before the pump stops. `null` means unlimited. |
| `log_size` | `number` | `128` | Ring buffer size for per-node logs. Oldest entries are evicted when full. |

```ts
// TypeScript
const flow = new FXFlowPlugin(fx, {
  order: "bfs",
  budgets: { maxSteps: 1000, maxMillis: 5000 },
  logSize: 256,
});
```

```rust
// Rust
let flow = FlowPlugin::new(logger, FlowConfig {
    order: ScheduleOrder::BFS,
    max_steps: Some(1000),
    max_millis: Some(5000),
    log_size: 256,
});
```

---

## Creating Flows

Call `.flow("path")` to create or retrieve a flow at the given FX tree path. This returns a `FlowHandle` (Rust) or `FlowAPI` (TypeScript) for chaining node definitions, connections, and execution.

```ts
// TypeScript
const handle = flowPlugin.flow("myApp.pipeline");
```

```rust
// Rust
let handle = flow_plugin.flow("myApp.pipeline");
```

If no path is provided in TypeScript, a unique path is auto-generated.

---

## NodeDef

Each node in a flow is defined by a `NodeDef`.

| Field | Type | Description |
|---|---|---|
| `effect` | `fn(&NodeContext) -> Result<()>` | The function to execute when this node runs. |
| `guard` | `fn(&NodeContext) -> bool` | If provided and returns `false`, the node's effect is skipped entirely. |
| `branch` | `fn(&NodeContext) -> Option<String>` | Dynamic routing: returns the name of the next node to enqueue. Overrides `next`. |
| `next` | `Vec<String>` | Default downstream nodes. All are enqueued after a successful effect (unless `branch` is set). |
| `retry` | `bool` | If `true`, the node's effect is retried up to 3 times with exponential backoff on failure. |

TypeScript adds additional fields:

| Field | Type | Description |
|---|---|---|
| `runsOn` | `"client"` \| `"server"` \| `"both"` | Where the node's effect executes. |
| `merge` | `"last"` \| `"all"` \| `"reduce"` | Strategy for merging results from parallel execution. |

### Defining nodes

Nodes are added via the chainable `.node()` method, then wired together with `.connect()` or the `next` field.

```ts
// TypeScript
flowPlugin.flow("myFlow")
  .node("validate", {
    runsOn: "client",
    effect: (ctx) => {
      if (!ctx.in.email) throw new Error("Missing email");
      ctx.set({ valid: true });
    },
    next: ["transform"],
  })
  .node("transform", {
    runsOn: "client",
    effect: (ctx) => {
      ctx.set({ email: ctx.in.email.toLowerCase() });
    },
    next: ["save"],
  })
  .node("save", {
    runsOn: "server",
    effect: (ctx) => {
      ctx.$db.insert("users", ctx.in);
    },
    retry: { maxAttempts: 3, backoffMs: 200 },
  })
  .start("validate", { email: "USER@EXAMPLE.COM" });
```

```rust
// Rust
flow_plugin.flow("myFlow")
    .node("validate", NodeDef {
        effect: Some(Arc::new(|ctx| {
            // validation logic
            Ok(())
        })),
        next: vec!["transform".into()],
        ..Default::default()
    })
    .node("transform", NodeDef {
        effect: Some(Arc::new(|ctx| {
            // transform logic
            Ok(())
        })),
        next: vec!["save".into()],
        ..Default::default()
    })
    .node("save", NodeDef {
        effect: Some(Arc::new(|ctx| {
            // persist logic
            Ok(())
        })),
        retry: true,
        ..Default::default()
    })
    .start("validate", FXValue::Null);
```

---

## NodeContext

Every node effect receives a `NodeContext` (Rust) or `NodeCtx` (TypeScript) with access to input data, shared state, and flow metadata.

| Field | Type | Description |
|---|---|---|
| `input` / `in` | `FXValue` / `any` | The payload passed when this node was enqueued. |
| `shared` | `HashMap<String, FXValue>` / `Record<string, any>` | Shared mutable state scoped to the flow instance. |
| `flow_path` | `String` | The FX tree path of the flow (e.g., `"myApp.pipeline"`). |
| `node_name` | `String` | The name of the currently executing node. |
| `trace_id` | `String` | Unique trace identifier for this queue item, useful for debugging. |
| `meta` | `HashMap<String, String>` / `Record<string, any>` | Arbitrary metadata attached to the node definition. |

### ctx.next()

Enqueue another node for execution from within an effect. This gives you imperative control over the flow graph at runtime.

```ts
// TypeScript
effect: (ctx) => {
  const result = process(ctx.in);
  ctx.next("downstream", result);
}
```

```rust
// Rust
effect: Some(Arc::new(move |ctx| {
    let result = process(&ctx.input);
    ctx.next("downstream", result, &flow_plugin);
    Ok(())
})),
```

### ctx.set()

In TypeScript, `ctx.set(value)` writes a value to the current node in the FX tree. This is the primary way nodes produce output.

### Logging

Nodes have built-in logging methods that write to the node's ring buffer:

```ts
ctx.log("Processing item", itemId);
ctx.warn("Unexpected format");
ctx.error("Failed to parse", err.message);
```

---

## pump()

`pump(flow_path)` is the core scheduler. It processes the queue in a loop until one of these conditions is met:

1. The queue is empty.
2. `max_steps` is exceeded.
3. `max_millis` is exceeded.

Items are dequeued based on the configured order:
- **BFS (default):** FIFO -- dequeue from the front. Processes all nodes at the current depth before moving deeper.
- **DFS:** LIFO -- dequeue from the back. Dives deep before processing siblings.

The pump is re-entrant safe: if `pump()` is called while already running for the same flow, the second call returns immediately.

```rust
// Rust
flow_plugin.pump("myFlow")?;
```

In TypeScript, `pump` is called automatically by `.start()` and when node values change.

---

## Events

FX Flow emits lifecycle events through its event bus. Subscribe with `.on()`.

| Event | When | EventData fields |
|---|---|---|
| `flow:start` | Pump begins processing | `flow` |
| `flow:idle` | Queue is empty after pump completes | `flow` |
| `node:before` | Before a node's effect runs | `flow`, `node`, `trace_id`, `payload` |
| `node:before:<name>` | Before a specific node runs | Same as above |
| `node:after` | After a node's effect succeeds | `flow`, `node`, `trace_id` |
| `node:after:<name>` | After a specific node succeeds | Same as above |
| `node:error` | After a node's effect fails | `flow`, `node`, `trace_id`, `error` |
| `node:error:<name>` | After a specific node fails | Same as above |

```ts
// TypeScript
flowPlugin.on("node:before:validate", (e) => {
  console.log(`Validating with trace ${e.traceId}`);
});

flowPlugin.on("flow:idle", (e) => {
  console.log(`Flow ${e.flow} finished`);
});
```

```rust
// Rust
flow_plugin.on("node:after:save", Arc::new(|data| {
    println!("Save completed, trace: {}", data.trace_id);
}));
```

---

## Logging Ring Buffer

Every node maintains two log stores at `<flowPath>.nodes.<name>.logs`:

- **`ring`** -- A fixed-size ring buffer (default 128 entries). When full, the oldest entry is evicted. Use this for live monitoring.
- **`full`** -- An unbounded append-only log. Use this for post-mortem debugging.

Each log entry contains:

```json
{
  "ts": 1710000000000,
  "level": "info",
  "args": ["Processing item", "abc123"]
}
```

---

## Guard Functions

A guard is a predicate that runs before the node's effect. If it returns `false`, the node is skipped entirely and a log entry is recorded.

```rust
// Rust -- only run if the user is authenticated
NodeDef {
    guard: Some(Arc::new(|ctx| {
        ctx.shared.read().unwrap().contains_key("auth_token")
    })),
    effect: Some(Arc::new(|ctx| {
        // only runs if guard passed
        Ok(())
    })),
    ..Default::default()
}
```

```ts
// TypeScript
{
  runsOn: "client",
  guard: (ctx) => ctx.shared.isAdmin === true,
  effect: (ctx) => {
    // admin-only logic
  },
}
```

---

## Branch Functions

Branches provide dynamic routing at runtime. When a branch function is defined, it overrides the static `next` list. The branch returns the name of the next node to enqueue, or `None`/`null` to stop.

```rust
// Rust
NodeDef {
    effect: Some(Arc::new(|ctx| {
        // compute something
        Ok(())
    })),
    branch: Some(Arc::new(|ctx| {
        if ctx.input.to_num() > 100.0 {
            Some("high_value".to_string())
        } else {
            Some("standard".to_string())
        }
    })),
    ..Default::default()
}
```

TypeScript supports two branch forms:

```ts
// when/then/else
branch: {
  when: (ctx) => ctx.in.amount > 100,
  then: "high_value",
  else: "standard",
}

// switch/cases
branch: {
  switch: (ctx) => ctx.in.type,
  cases: { "A": "handleA", "B": "handleB" },
  default: "handleDefault",
}
```

---

## Retry with Backoff

Enable retry on a node to automatically re-execute its effect on failure. The default policy is 3 attempts with exponential backoff (starting at 150ms, multiplier 2x) and random jitter.

| Parameter | Default | Description |
|---|---|---|
| `maxAttempts` | `3` | Total attempts before giving up. |
| `backoffMs` | `150` | Initial delay between retries in milliseconds. |
| `multiplier` | `2.0` | Backoff multiplier applied after each retry. |
| `jitter` | `true` | Add randomness (0.5x-1.0x) to prevent thundering herd. |

```rust
// Rust -- enable with defaults
NodeDef {
    effect: Some(Arc::new(|ctx| {
        // might fail
        Ok(())
    })),
    retry: true,
    ..Default::default()
}
```

```ts
// TypeScript -- custom retry config
{
  runsOn: "server",
  effect: (ctx) => { /* might fail */ },
  retry: {
    maxAttempts: 5,
    backoffMs: 200,
    multiplier: 1.5,
    jitter: true,
    useSafePlugin: true, // delegate to fx-safe if available
  },
}
```

When `useSafePlugin` is `true` and the Safe plugin is loaded, retry is delegated to the Safe plugin's more full-featured retry implementation.

---

## XSLT Integration

FX Flow serves as the execution engine for XSLT processing. XSLT templates are compiled into flow nodes and executed with BFS scheduling, which naturally provides the correct breadth-first template matching order without recursion. Key integration points:

- **BFS order** ensures templates are applied level-by-level through the document tree.
- **`flow:start` and `flow:idle` events** trigger time-travel snapshots for checkpointing.
- **Guards** implement `xsl:if` and `xsl:when` conditions.
- **Branches** implement `xsl:choose` / `xsl:otherwise` routing.
- **Shared state** carries the XSLT output document and variable bindings across nodes.

---

## Full Example

```ts
const pipeline = flowPlugin.flow("etl.pipeline");

pipeline
  .node("extract", {
    runsOn: "server",
    effect: (ctx) => {
      const data = ctx.$db.query("SELECT * FROM source");
      ctx.next("transform", data);
    },
  })
  .node("transform", {
    runsOn: "client",
    effect: (ctx) => {
      const cleaned = ctx.in.map(normalize);
      ctx.next("load", cleaned);
    },
    guard: (ctx) => Array.isArray(ctx.in) && ctx.in.length > 0,
  })
  .node("load", {
    runsOn: "server",
    effect: (ctx) => {
      ctx.$db.bulkInsert("target", ctx.in);
      ctx.log("Loaded", ctx.in.length, "records");
    },
    retry: { maxAttempts: 3, backoffMs: 500 },
  })
  .on("flow:idle", () => console.log("ETL complete"))
  .start("extract", {});
```
