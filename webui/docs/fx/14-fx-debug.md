# FX Debug Plugin

The Debug plugin provides production-grade debugging for FX graphs. It wires together the TimeTravelPlugin, FlowPlugin events, and FXCore to deliver breakpoints, structural diffs, focused subtree dumps, and step-through execution.

All debug state lives in FX nodes under `debug.*`, giving full observability and time-travel compatibility. The plugin is zero-cost when no breakpoints are active.

## Initialization

```rust
let dbg = DebugPlugin::new(logger.clone());
dbg.initialize(Arc::clone(&fx))?;
```

On initialization the plugin writes metadata into the FX tree:

| FX Path | Value |
|---|---|
| `debug.version` | `"1.0.0"` |
| `debug.active` | `true` |
| `debug.breakpoint_count` | `0` |
| `debug.hit_count` | `0` |

## Breakpoint Types

A breakpoint is defined by a **BreakCondition** that determines when it fires:

| Condition | Factory Method | Fires When |
|---|---|---|
| `PathWrite(pattern)` | `Breakpoint::on_path("xslt.output.*")` | Any FX node matching the glob pattern is written |
| `ValueChange(path)` | `Breakpoint::on_value_change("app.name")` | A specific FX node's value changes |
| `BeforeRule(name)` | `Breakpoint::on_rule("dispatch")` | A named flow node is about to execute |
| `AfterRule(name)` | *(set condition directly)* | A named flow node finishes executing |
| `OnError(name)` | `Breakpoint::on_error("transform")` | A flow node errors (`"*"` matches all) |
| `EveryNSteps(n)` | `Breakpoint::every_n_steps(10)` | Every Nth flow step (periodic sampling) |
| `ValueEquals(path, val)` | `Breakpoint::on_value_equals("status", FXValue::from("done"))` | An FX value at a path equals an expected value |
| `Custom(name, fn)` | *(set condition directly)* | A custom predicate returns `true` |

### Glob Patterns

`PathWrite` uses glob matching on dot-separated paths:

- `"xslt.output.*"` -- matches any descendant of `xslt.output`
- `"*.current_node"` -- matches any path ending in `current_node`
- `"*"` -- matches everything

## BreakAction

Every breakpoint carries a `BreakAction` that controls what happens when it fires:

| Field | Type | Default | Description |
|---|---|---|---|
| `snapshot` | `bool` | `true` | Take a time-travel snapshot |
| `dump_subtree` | `Option<String>` | `None` | Dump a focused subtree rooted at this path |
| `dump_depth` | `usize` | `5` | Maximum depth for subtree dumps |
| `log_message` | `Option<String>` | `None` | Log a message when hit |

## Setting Breakpoints

Register breakpoints by name using builder-style configuration:

```rust
// Basic path-write breakpoint
dbg.breakpoint("watch_output", Breakpoint::on_path("xslt.output.*"));

// Value-change breakpoint with a log message and hit limit
dbg.breakpoint("watch_name",
    Breakpoint::on_value_change("app.name")
        .with_message("name changed!")
        .with_max_hits(5)
);

// Rule breakpoint with focused subtree dump
dbg.breakpoint("before_dispatch",
    Breakpoint::on_rule("dispatch")
        .with_dump("xslt.context")
        .with_depth(3)
);

// Value-equals breakpoint
dbg.breakpoint("done_check",
    Breakpoint::on_value_equals("status", FXValue::from("complete"))
);
```

### max_hits Limits

Set `with_max_hits(n)` to limit how many times a breakpoint fires. Once the hit count reaches `n`, the breakpoint stops triggering but remains registered. This prevents runaway logging in hot paths.

```rust
dbg.breakpoint("sampler",
    Breakpoint::on_path("metrics.*")
        .with_max_hits(10)  // Only capture the first 10 writes
);
```

### Managing Breakpoints

```rust
dbg.set_enabled("watch_output", false);  // Disable without removing
dbg.set_enabled("watch_output", true);   // Re-enable
dbg.remove_breakpoint("watch_output");   // Remove entirely
dbg.clear_breakpoints();                 // Remove all

// List active breakpoints: Vec<(name, enabled, hit_count)>
let bps = dbg.list_breakpoints();
```

## Subscribing to Flow Events

Connect the debug plugin to a FlowPlugin so breakpoints are evaluated automatically:

```rust
let dbg = Arc::new(DebugPlugin::new(logger.clone()));
dbg.initialize(Arc::clone(&fx))?;
dbg.subscribe_to_flow(&flow);
```

`subscribe_to_flow` registers listeners for five events:

| Event | Purpose |
|---|---|
| `flow:start` | Flow lifecycle start |
| `flow:idle` | Flow lifecycle idle |
| `node:before` | Before a flow node executes |
| `node:after` | After a flow node executes |
| `node:error` | When a flow node errors |

Value-change breakpoints (`ValueChange`, `PathWrite`) are sampled on every `node:after` event since `val_set` does not emit events directly.

## Inspecting Breakpoint Hits

Each time a breakpoint fires, a `BreakpointHit` is recorded:

| Field | Type | Description |
|---|---|---|
| `breakpoint_name` | `String` | Name of the breakpoint that fired |
| `summary` | `String` | Human-readable description |
| `snap_before` | `String` | Snapshot ID taken before the triggering action |
| `snap_after` | `String` | Snapshot ID taken after the triggering action |
| `subtree_dump` | `Option<String>` | Focused subtree dump (if configured) |
| `hit_number` | `usize` | 1-based hit number |
| `timestamp_ms` | `u64` | Milliseconds since epoch |

```rust
// Get all hits
let all_hits = dbg.hits();

// Get hits for a specific breakpoint
let name_hits = dbg.hits_for("watch_name");

// Get the last 3 hits
let recent = dbg.last_hits(3);

// Clear recorded hits
dbg.clear_hits();
```

## Structural Diffs: StateDiff and DiffEntry

The debug plugin can compare two time-travel snapshots to produce a structural diff.

A `StateDiff` contains a list of `DiffEntry` values:

| Variant | Display | Meaning |
|---|---|---|
| `Added { path, value }` | `+ path = value` | Node was added |
| `Removed { path, value }` | `- path = value` | Node was removed |
| `Changed { path, old, new }` | `~ path : old -> new` | Node value changed |

```rust
// Diff two snapshots by ID
let diff = dbg.diff(&hit.snap_before, &hit.snap_after)?;
println!("{}", diff);
// Output:
//   --- Diff: +1 -0 ~2 ---
//     ~ app.name : "hello" -> "world"
//     ~ app.count : 1 -> 2
//     + app.new_field = "added"

// Diff a specific breakpoint hit (convenience)
let diff = dbg.diff_hit(&hit)?;

// Diff the last two snapshots ("what just changed?")
let diff = dbg.diff_last()?;
println!("Added: {}, Removed: {}, Changed: {}",
    diff.added_count, diff.removed_count, diff.changed_count);
```

## Subtree Dumps

Dump a focused portion of the FX tree as indented text or JSON:

```rust
// Indented text dump
let text = dbg.dump_subtree("xslt.output", 3);
// Output:
//   output:
//     nodes:
//       0 = String("div")
//       1 = String("Hello")

// JSON dump
let json = dbg.dump_subtree_json("xslt.output", 3)?;
```

## Quick Inspection Helpers

Read values from the FX tree without going through FXCore directly:

```rust
let val   = dbg.get("app.name");          // FXValue
let name  = dbg.get_str("app.name");      // String
let count = dbg.get_num("app.count");      // f64
```

## XSLT Debugging Helpers

The plugin includes convenience methods for XSLT debugging:

```rust
// Current XSLT context
let ctx = dbg.xslt_context();
// Returns: { current_node, current_rule, position, size, mode }

// Output tree dump
let output = dbg.xslt_output_dump();

// XPath evaluation state
let xpath = dbg.xpath_state();
// Returns: { last_expr, eval_count, cache_hits, cache_misses }
```

### XSLT Attributes

In XSLT stylesheets, the debug plugin responds to:

- `fx:break` -- sets a breakpoint on the template/rule
- `fx:trace` -- enables trace logging for the template

## Debug Report

Generate a full debug report suitable for agent consumption:

```rust
let report = dbg.report();
println!("{}", report);
// Output:
//   === FX Debug Report ===
//
//   ## XSLT Context
//     current_node: xslt.core.input.dom.0
//     current_rule: dispatch
//
//   ## XPath State
//     last_expr: /root/child
//     eval_count: 42
//
//   ## Breakpoints
//     watch_name [ON] hits=3
//
//   ## Recent Hits
//     #3 BP 'watch_name' fired on value_changed:app.name (hit #3) @ 1700000000000ms
//
//   ## Snapshots (6)
//     debug:watch_name... - debug:watch_name:after:#3
```

## Snapshot and Rollback

The debug plugin exposes the internal TimeTravelPlugin for direct control:

```rust
// Manual snapshot
let snap_id = dbg.snapshot("before risky operation")?;

// List all snapshots: Vec<(id, description, timestamp_ms)>
let snaps = dbg.list_snapshots();

// Rollback to a previous state
dbg.rollback(&snap_id)?;

// Access the underlying TimeTravelPlugin
let tt = dbg.time_travel();
```

## Complete Example

```rust
let fx = Arc::new(FXCore::new(logger.clone()));
let dbg = Arc::new(DebugPlugin::new(logger.clone()));
dbg.initialize(Arc::clone(&fx))?;
dbg.subscribe_to_flow(&flow);

// Set breakpoints
dbg.breakpoint("bp1", Breakpoint::on_path("xslt.output.*"));
dbg.breakpoint("bp2", Breakpoint::on_rule("dispatch"));
dbg.breakpoint("bp3",
    Breakpoint::on_value_change("xslt.context.current_node")
        .with_dump("xslt.context")
        .with_max_hits(20)
);

// ... run XSLT transform ...

// Inspect what happened
for hit in dbg.hits() {
    println!("{}", hit.summary);
    let diff = dbg.diff_hit(&hit)?;
    println!("{}", diff);
    if let Some(dump) = &hit.subtree_dump {
        println!("{}", dump);
    }
}

// Or get the full report
println!("{}", dbg.report());
```
