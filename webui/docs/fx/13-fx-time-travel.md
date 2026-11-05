# FX Time Travel Plugin

**Plugin name:** `time`
**Version:** 1.0.0

FX Time Travel provides state snapshots, undo/redo, and timeline branching for the entire FX tree. Every snapshot captures a full JSON export of the FX state, allowing you to roll back to any previous point, explore alternative timelines, and compare outcomes.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Snapshot** | A complete serialization of the FX tree at a moment in time, identified by a unique ID. |
| **Timeline** | A named, ordered sequence of snapshots. The default timeline is `"main"`. |
| **Branch** | A new timeline forked from the current state. Changes in a branch do not affect the parent timeline. |
| **Undo/Redo** | Navigate backward and forward through snapshots on the current timeline. |

---

## Snapshot

A snapshot captures the entire FX state as a JSON string along with metadata.

### Snapshot fields

| Field | Type | Description |
|---|---|---|
| `id` | `String` | Unique identifier (e.g., `"snap_<uuid>"`). |
| `description` | `String` | Human-readable label for the snapshot. |
| `timestamp` | `u64` | Unix timestamp (seconds) when the snapshot was taken. |
| `timeline` | `String` | Name of the timeline this snapshot belongs to. |
| `state` | `String` | Full JSON export of the FX tree. |
| `meta` | `HashMap<String, String>` | Arbitrary metadata (tags, annotations). |

### Creating a snapshot

```rust
// Rust
let snapshot_id = time_travel.snapshot("After user login")?;
println!("Snapshot saved: {}", snapshot_id);
```

Snapshots are appended to the current timeline and the current index advances to point at the new snapshot. The snapshot description is also stored in the FX tree at `time.snapshots.<id>.description`.

---

## Undo / Redo

Navigate through the snapshot history on the current timeline.

### undo(steps)

Move backward by `steps` snapshots and restore that state.

```rust
// Rust
// State: [snap_0, snap_1, snap_2]  (current index = 2)
time_travel.undo(1)?;
// Now at snap_1 (current index = 1)

time_travel.undo(2)?;
// Saturates at 0 -- now at snap_0 (current index = 0)
```

### redo(steps)

Move forward by `steps` snapshots and restore that state.

```rust
// Rust
// Currently at snap_0 (current index = 0)
time_travel.redo(1)?;
// Now at snap_1 (current index = 1)

time_travel.redo(100)?;
// Saturates at last snapshot -- now at snap_2 (current index = 2)
```

Both `undo` and `redo` clamp to the valid range. You cannot undo past the first snapshot or redo past the last.

---

## Rollback to ID

Restore a specific snapshot by its ID, regardless of position.

```rust
// Rust
time_travel.rollback_to_id("snap_abc123")?;
```

This finds the snapshot with the given ID on the current timeline, restores its state via `import_json`, and sets the current index to that position.

Returns an error if the snapshot ID is not found on the current timeline.

---

## Timeline Branching

Branches let you explore alternative paths without affecting the main timeline. This is the foundation for what-if analysis and speculative execution.

### branch(name, function)

1. Takes a snapshot of the current state as the branch base.
2. Switches to the named branch timeline.
3. Executes the provided function (your experimental changes).
4. Takes a snapshot of the branch result.
5. Switches back to the previous timeline.

```rust
// Rust
fx.proxy("config.rate").val_set(0.05);

time_travel.branch("experiment_higher_rate", || {
    fx.proxy("config.rate").val_set(0.10);
    // Run some computation...
    recalculate_portfolio(&fx);
    Ok(())
})?;

// Back on "main" timeline -- config.rate is still 0.05
assert_eq!(fx.proxy("config.rate").num(), 0.05);
```

### Comparing timelines

After branching, compare the final states of two timelines:

```rust
let diff = time_travel.compare("main", "experiment_higher_rate")?;
println!("{}", diff);
// Timeline A: Base for branch: experiment_higher_rate
// Timeline B: Post-branch: experiment_higher_rate
// State diff: 142 bytes
```

---

## Listing Snapshots

Retrieve all snapshots on the current timeline as `(id, description, timestamp)` tuples.

```rust
let snapshots = time_travel.list_snapshots();
for (id, desc, ts) in &snapshots {
    println!("[{}] {} ({})", id, desc, ts);
}
// [initial] Initial state (1710000000)
// [snap_abc] After user login (1710000005)
// [snap_def] After checkout (1710000010)
```

---

## Initialization

When the plugin initializes, it automatically creates an `"initial"` snapshot on the `"main"` timeline, capturing the FX tree's state at startup. This ensures you always have a baseline to roll back to.

```
Timelines at startup:
  main: [initial]
         ^-- current index = 0
```

---

## XSLT Integration

The XSLT engine uses Time Travel for checkpointing during flow execution. FX Flow events trigger snapshots:

| Flow Event | Snapshot Action |
|---|---|
| `flow:start` | Snapshot taken with label `"flow:start <flowPath>"` |
| `flow:idle` | Snapshot taken with label `"flow:idle <flowPath>"` |

This means every XSLT transformation has a before-and-after snapshot. If a transformation produces unexpected results, you can:

1. List snapshots to find the `flow:start` checkpoint.
2. Roll back to inspect the pre-transformation state.
3. Branch to try a different approach without losing the original result.

```rust
// Inspect what happened during an XSLT run
let snaps = time_travel.list_snapshots();
// [..., ("snap_x", "flow:start xslt.run_1", 1710000020),
//       ("snap_y", "flow:idle xslt.run_1", 1710000021)]

// Roll back to before the transformation
time_travel.rollback_to_id("snap_x")?;
```

---

## Use Cases

### Debugging

Capture snapshots at key points in your application and roll back when something goes wrong.

```rust
time_travel.snapshot("Before risky operation")?;

match perform_risky_operation(&fx) {
    Ok(_) => time_travel.snapshot("After risky operation")?,
    Err(e) => {
        eprintln!("Operation failed: {:?}", e);
        time_travel.undo(1)?;  // restore pre-operation state
        return Err(e);
    }
};
```

### Undo in user interfaces

Provide undo/redo functionality by taking a snapshot after each user action.

```rust
// User makes an edit
apply_user_edit(&fx, edit);
time_travel.snapshot(&format!("Edit: {}", edit.description))?;

// User presses Ctrl+Z
time_travel.undo(1)?;

// User presses Ctrl+Shift+Z
time_travel.redo(1)?;
```

### What-if analysis

Use branches to evaluate multiple strategies without committing to any of them.

```rust
time_travel.snapshot("Baseline")?;

// Try strategy A
time_travel.branch("strategy_a", || {
    apply_strategy_a(&fx);
    Ok(())
})?;

// Try strategy B
time_travel.branch("strategy_b", || {
    apply_strategy_b(&fx);
    Ok(())
})?;

// Compare outcomes
let comparison = time_travel.compare("strategy_a", "strategy_b")?;
println!("{}", comparison);
```
