# fx-relay

WebSocket client for receiving binary delta patches from a Rust FX Relay server. Streams real-time state changes into the local FX graph using MessagePack-encoded binary deltas.

## Quick start

```ts
import FXRelayPlugin from './plugins/fx-relay';

const relay = new FXRelayPlugin(fx, {
  url: 'ws://127.0.0.1:9876',
  autoConnect: true,
  autoReconnect: true,
  debug: false
});

relay.subscribe('app.**');
```

## Architecture

```
Rust FX Relay Server (port 9876)
    |  binary delta patches (MessagePack)
    v
TypeScript FX Relay Client (this plugin)
    |  applies patches to local FX graph
    v
Local FX nodes updated reactively
```

## Connection management

```ts
relay.connect();                         // connect (or reconnect)
relay.connect('ws://other-server:9876'); // connect to different URL
relay.disconnect();
relay.isConnected();                     // boolean
relay.getState();                        // 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'
relay.ping();                            // send keepalive
```

Auto-reconnect uses exponential backoff with configurable delay and max attempts.

## Subscriptions

Subscribe to node path patterns to receive delta patches:

```ts
relay.subscribe('app.users');            // exact path
relay.subscribe('app.users.*');          // single-level wildcard
relay.subscribe('app.**');               // recursive wildcard (all descendants)
relay.subscribe('**');                   // everything

relay.unsubscribe('app.users');
relay.getSubscriptions();                // string[]
relay.clearSubscriptions();
```

Subscriptions are automatically re-sent when the connection is re-established.

## Delta patch format

Each patch describes a single field change on a node:

```ts
interface FXDeltaPatch {
  timestamp_ns: number;      // nanosecond timestamp
  node_path: string;         // e.g. "app.users.42"
  field: string;             // "__value", "__meta[key]", "__nodes[child]"
  new_value: any;
  old_value?: any;
  event_type: string;
}
```

Patches are decoded from MessagePack binary (or JSON fallback) and applied in order via a FIFO queue.

## Hooks

Hooks let you intercept and modify patch processing:

### BeforeUpdate

Called before a patch is applied. Return `false` to skip the update.

```ts
relay.onBeforeUpdate((path, field, oldValue, newValue) => {
  if (path.startsWith('readonly.')) return false; // block updates to readonly paths
});
```

### Update

Called during patch application:

```ts
relay.onUpdate((path, field, oldValue, newValue) => {
  console.log(`Updating ${path}.${field}: ${oldValue} -> ${newValue}`);
});
```

### AfterUpdate

Called after a patch has been applied:

```ts
relay.onAfterUpdate((path, field, oldValue, newValue) => {
  analytics.track('state_change', { path, field });
});
```

```ts
relay.clearHooks(); // remove all hooks
```

## Wire format

The plugin supports two encoding modes:

| Mode | Config | Description |
|------|--------|-------------|
| MessagePack | `useMsgpack: true` (default) | Binary encoding, compact and fast |
| JSON | `useMsgpack: false` | Text encoding, useful for debugging |

Client-to-server messages (subscribe, unsubscribe, ping) are always sent as JSON.

## Statistics

```ts
relay.getStats();
// {
//   patchesReceived: 1234,
//   patchesApplied: 1230,
//   patchesFailed: 4,
//   bytesReceived: 56789,
//   lastPatchTime: 1710000000000,
//   state: 'connected'
// }

relay.resetStats();
```

Stats are also mirrored in the FX tree under `relay.stats.*` and `relay.state`.

## Configuration

```ts
interface FXRelayOptions {
  url?: string;                  // default: 'ws://127.0.0.1:9876'
  autoConnect?: boolean;         // default: true
  autoReconnect?: boolean;       // default: true
  reconnectDelay?: number;       // default: 1000 (ms), uses exponential backoff
  maxReconnectAttempts?: number; // default: 0 (infinite)
  debug?: boolean;               // default: false
  useMsgpack?: boolean;          // default: true
}
```
