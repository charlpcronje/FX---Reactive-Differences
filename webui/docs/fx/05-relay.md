# Relay: Real-Time Binary Patch Streaming

The FX Relay is a WebSocket server that streams node tree changes to connected clients in real time. It supports configurable wire formats, bidirectional sync, path-based subscriptions, and batched updates for high throughput.

---

## Overview

```
  FX Node Tree (Rust)
        |
  StructureEvent (ValueChanged, NodeCreated, ...)
        |
  FXRelayPlugin
    - creates FXDeltaPatch
    - matches against client subscriptions
    - encodes in client's preferred format
        |
  WebSocket
        |
  FXRelayClient (TypeScript)
    - decodes patch
    - applies to local FX tree
    - can send patches back (bidirectional)
```

---

## Wire Formats

Each client can independently choose its encoding format. The server encodes messages in whatever format the client has negotiated.

| Format | Identifier | Best For | Relative Speed |
|---|---|---|---|
| **Bincode** | `Bincode` / `"bincode"` | Rust-to-Rust communication | Fastest (~45ns encode) |
| **JSON** | `Json` / `"json"` | TypeScript/browser interop | Universal (~120ns encode) |
| **MessagePack** | `MsgPack` / `"msgpack"` | Cross-language binary | Compact binary |

New connections default to JSON. Clients switch format by sending a `set_format` message; the server acknowledges with `format_ack`.

### Size Comparison

For a typical patch `{ node_path: "test.path", field: "__value", old: 42.0, new: 43.0 }`:

| Format | Approximate Size |
|---|---|
| Bincode | ~60-80 bytes |
| JSON | ~150-200 bytes |
| MessagePack | ~100-130 bytes |

---

## FXDeltaPatch

The atomic unit of change. Every node mutation produces one delta patch.

```rust
pub struct FXDeltaPatch {
    pub timestamp_ns: u64,           // Nanosecond timestamp
    pub node_path: String,           // e.g., "app.settings.theme"
    pub field: String,               // e.g., "__value"
    pub new_value: FXValue,          // The new value
    pub old_value: Option<FXValue>,  // Previous value (for undo/conflict resolution)
    pub event_type: String,          // "update", "create", "delete"
}
```

TypeScript equivalent:

```typescript
interface FXDeltaPatch {
    timestamp_ns: number;
    node_path: string;
    field: string;
    new_value: unknown;
    old_value?: unknown;
    event_type: string;
}
```

### Encoding / Decoding

```rust
// Rust
let patch = FXDeltaPatch::new(
    "app.user".to_string(),
    "__value".to_string(),
    Some(FXValue::from("Bob")),
    FXValue::from("Alice"),
    "update".to_string(),
);

let bytes = patch.encode(WireFormat::Bincode)?;
let decoded = FXDeltaPatch::decode(&bytes, WireFormat::Bincode)?;
```

```typescript
// TypeScript
const codec = new RelayCodec("json");

const encoded: Uint8Array = codec.encodePatch({
    timestamp_ns: Date.now() * 1_000_000,
    node_path: "app.user",
    field: "__value",
    new_value: "Alice",
    old_value: "Bob",
    event_type: "update",
});

const decoded: FXDeltaPatch = codec.decodePatch(encoded);
```

---

## FXPatchBatch

For high-throughput scenarios, multiple patches are grouped into a single batch to reduce WebSocket frame overhead.

```rust
pub struct FXPatchBatch {
    pub batch_id: u64,
    pub timestamp_ns: u64,
    pub patches: Vec<FXDeltaPatch>,
}
```

The relay accumulates patches and flushes when the count reaches `batch_threshold` (default: 16, configurable).

```rust
let batch = FXPatchBatch::new(vec![patch1, patch2, patch3]);
let bytes = batch.encode(WireFormat::Json)?;
```

---

## Client Subscription Model

Clients subscribe to node paths using pattern matching. Only patches matching a client's subscriptions are forwarded to that client.

### Path Patterns

| Pattern | Matches | Example |
|---|---|---|
| `app.settings.theme` | Exact path only | `app.settings.theme` |
| `app.settings.*` | Direct children only | `app.settings.theme`, `app.settings.lang` (not `app.settings.theme.color`) |
| `app.**` | All descendants | `app.settings.theme`, `app.settings.theme.color`, `app.user.name` |
| `**` | Everything | All paths |

### Subscription Examples

```typescript
// TypeScript client
client.subscribe("app.settings.*");       // All direct settings
client.subscribe("ui.**");                // Entire UI subtree
client.subscribe("rfs.certainty.core");   // One specific node

client.unsubscribe("ui.**");              // Stop receiving UI updates
```

```json
// Wire format
{ "type": "subscribe", "path": "app.**" }
{ "type": "unsubscribe", "path": "app.**" }
```

---

## Message Protocol

### Client -> Server

| Type | Fields | Description |
|---|---|---|
| `subscribe` | `path: string` | Subscribe to a path pattern |
| `unsubscribe` | `path: string` | Unsubscribe from a path pattern |
| `ping` | -- | Keepalive ping |
| `set_format` | `format: WireFormat` | Request a wire format change |
| `patch` | `payload: bytes` | Send a patch to the server (bidirectional sync) |
| `batch` | `payload: bytes` | Send a batch of patches |

### Server -> Client

| Type | Fields | Description |
|---|---|---|
| `patch` | `payload: bytes` | A single delta patch |
| `batch` | `payload: bytes` | A batch of delta patches |
| `hot_shard` | `payload: bytes` | A VFS hot shard update |
| `pong` | -- | Response to ping |
| `format_ack` | `format: WireFormat` | Confirms format change |
| `error` | `message: string` | Error description |

Text WebSocket frames carry JSON-encoded `ClientMessage`/`ServerMessage`. Binary frames carry raw patch data encoded in the client's negotiated format.

---

## Bidirectional Sync

Clients can send patches back to the server. The server applies them to its FX tree, which then triggers structure events that propagate to other subscribed clients.

```
Client A                    Server                    Client B
   |                          |                          |
   |-- patch: x=1 ---------->|                          |
   |                          |-- apply to FX tree       |
   |                          |-- structure event fires  |
   |                          |-- patch: x=1 ---------->|
   |                          |                          |
   |                          |<-- patch: y=2 ----------|
   |<-- patch: y=2 ----------|                          |
```

```typescript
// Client sends a patch
client.sendPatch({
    timestamp_ns: Date.now() * 1_000_000,
    node_path: "app.counter",
    field: "__value",
    new_value: 42,
    event_type: "update",
});
```

---

## Per-Client Format Negotiation

Each client tracks its own state:

```rust
pub struct ClientState {
    pub id: WebSocketId,
    pub subscriptions: HashSet<String>,
    pub connected_at: u64,
    pub wire_format: WireFormat,      // Per-client format
    pub patches_received: u64,
    pub patches_sent: u64,
    pub bytes_sent: u64,
}
```

Client A can use Bincode while Client B uses JSON. The server encodes each outgoing message in the recipient's format.

```typescript
// Switch to bincode after connecting
client.setFormat("bincode");
// Server responds with: { "type": "format_ack", "format": "bincode" }
```

---

## Hook System

The relay supports hooks that fire during the patch lifecycle. Hooks receive the node path, field name, old value, and new value.

| Hook | When It Fires |
|---|---|
| `before_update` | Before applying a patch to the FX tree |
| `update` | During patch application |
| `after_update` | After the patch has been applied |

```rust
let relay = FXRelayPlugin::new(logger);

relay.on_before_update(|path, field, old, new| {
    println!("About to update {}.{}: {:?} -> {:?}", path, field, old, new);
});

relay.on_after_update(|path, field, _old, new| {
    // Log, audit, trigger side effects
    audit_log(path, field, new);
});
```

---

## Rust Server Setup

```rust
use fx_assembly::{FXCore, FXLogger};
use fx_assembly::fx_relay::{FXRelayPlugin, WireFormat};

let fx = Arc::new(FXCore::new(FXLogger::default()));
let relay = Arc::new(FXRelayPlugin::new(FXLogger::default()));

// Configure
relay.set_default_format(WireFormat::Json);
relay.set_batch_threshold(32);

// Initialize (registers with FX, subscribes to structure events)
relay.initialize(Arc::clone(&fx))?;

// Start WebSocket server (default: 127.0.0.1:9876)
fx.proxy("relay.config.ws_addr").val_set(FXValue::from("0.0.0.0:9876"));
let relay_clone = Arc::clone(&relay);
tokio::spawn(async move {
    relay_clone.start_server().await.unwrap();
});

// FX tree nodes created by the relay plugin:
// relay.config.ws_addr      = "127.0.0.1:9876"
// relay.config.default_format = "json"
// relay.config.batch_threshold = 16
// relay.stats.patches_sent  = 0
// relay.stats.bytes_sent    = 0
// relay.stats.clients_connected = 0
```

---

## TypeScript Relay Client

The `fx-relay-binary.ts` module provides `FXRelayClient` and a convenience `connectFXRelay` function.

### FXRelayClient

```typescript
import { FXRelayClient } from "./core/fx-relay-binary";

const client = new FXRelayClient("ws://localhost:9876", "json");

await client.connect();

// Subscribe to paths
client.subscribe("app.**");
client.subscribe("ui.galaxy.*");

// Receive patches
client.onPatch((patch) => {
    console.log(`${patch.node_path} changed to`, patch.new_value);
});

// Receive batches
client.onBatch((batch) => {
    console.log(`Received ${batch.patches.length} patches`);
});

// Send patches
client.sendPatch({
    timestamp_ns: Date.now() * 1_000_000,
    node_path: "app.counter",
    field: "__value",
    new_value: 1,
    event_type: "update",
});

// Switch format
client.setFormat("bincode");

// Keepalive
client.ping();

// Disconnect (disables auto-reconnect)
client.disconnect();
```

### connectFXRelay: Full Integration

For the common case of bidirectional sync between a local FX instance and a relay server:

```typescript
import { connectFXRelay } from "./core/fx-relay-binary";

const disconnect = connectFXRelay(
    fx,                        // FXCore instance
    "ws://localhost:9876",     // Relay URL
    "json",                    // Wire format
    ["**"],                    // Subscription patterns
);

// All local changes are now sent to the relay
$$("app.name").set("Hello");  // -> automatically sent as patch

// All remote patches are applied to the local tree
// (other clients' changes appear locally)

// Clean up
disconnect();
```

`connectFXRelay` does three things:
1. Connects to the relay and subscribes to the given patterns.
2. Listens for structure events on the local FX tree and sends them as patches.
3. Receives incoming patches and applies them to the local FX tree.

### RelayCodec

The `RelayCodec` class handles encoding and decoding for all three formats:

```typescript
const codec = new RelayCodec("bincode");

// Encode a patch
const bytes: Uint8Array = codec.encodePatch(patch);

// Decode a patch
const decoded: FXDeltaPatch = codec.decodePatch(bytes);

// Encode/decode batches
const batchBytes = codec.encodeBatch(batch);
const decodedBatch = codec.decodeBatch(batchBytes);

// Switch format
codec.setFormat("json");
```

The bincode encoder in TypeScript writes fields in the same order as Rust's `#[derive(Serialize)]`: timestamp, node_path, field, new_value, old_value (as `Option`), event_type. Strings are length-prefixed with u64 LE. `FXValue` is encoded as a JSON string within the bincode frame for cross-language compatibility.

---

## Auto-Reconnect

`FXRelayClient` automatically reconnects after disconnection (2-second interval by default). On reconnect, it re-subscribes to all previously registered path patterns. Call `disconnect()` to disable auto-reconnect and close cleanly.
