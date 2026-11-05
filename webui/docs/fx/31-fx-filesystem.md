# fx-filesystem

Mirrors FX nodes to a shared filesystem directory for cross-language IPC. Other FX implementations (Rust, Go, PHP, Python) can read and write the same node files, enabling polyglot state sharing. Optimized for RamDisk (`/dev/shm`) performance.

## Quick start

```ts
import createFilesystemPlugin from './plugins/fx-filesystem';

const fsPlugin = await createFilesystemPlugin(fx, {
  baseDir: '/dev/shm/fx-nodes',   // RamDisk for speed
  autoSync: true,
  watchChanges: true
});
```

## How it works

Each FX node is stored as a directory containing:
- `.fxmeta` -- JSON metadata (id, parent, type, proto chain, timestamp)
- `value.fxval` -- JSON-serialized node value with type information

When an FX node changes, the plugin queues it for sync. A background worker writes changes to disk at the configured interval. Conversely, a filesystem watcher (via chokidar) detects external changes and updates the FX graph.

## Bidirectional sync

### FX -> Filesystem

```ts
// Automatic: any FX node change is queued and synced
$$('app.config').val({ theme: 'dark' });
// -> writes to /dev/shm/fx-nodes/app_config/value.fxval

// Manual sync
await fsPlugin.syncNode('app.config');
```

### Filesystem -> FX

When another process (e.g., a Rust FX instance) writes to the same directory, the chokidar watcher picks up the change and updates the corresponding FX node. Changes are debounced (default 100ms).

## File format

### Metadata (`.fxmeta`)

```json
{
  "__id": "app.config",
  "__parent_id": "app",
  "__type": "object",
  "__proto": [],
  "__timestamp": 1710000000000000000,
  "__fx_version": "2.0.0",
  "__file_path": "/dev/shm/fx-nodes/app_config"
}
```

### Value (`value.fxval`)

```json
{
  "type": "object",
  "content": { "theme": "dark", "lang": "en" },
  "size": 42
}
```

Supported value types: `null`, `undefined`, `number`, `string`, `boolean`, `object`, `array`, `function` (name only), `symbol` (description only), `bigint` (string representation).

## Backups

When enabled, the plugin periodically copies the entire base directory to a timestamped backup. Old backups beyond the retention limit are automatically cleaned up.

```ts
createFilesystemPlugin(fx, {
  backupEnabled: true,
  backupInterval: 300000,   // every 5 minutes
  backupRetention: 5        // keep last 5 backups
});
```

## Statistics

```ts
fsPlugin.getStats();
// {
//   syncOperations: 42,
//   fileOperations: 84,
//   backupCount: 3,
//   errors: 0,
//   lastSync: Date,
//   lastBackup: Date,
//   nodesTracked: 15,
//   totalBytes: 12345
// }
```

## Cleanup

```ts
await fsPlugin.destroy();
// Stops sync worker, backup worker, filesystem watcher, and FX node watchers
```

## Configuration

```ts
interface FilesystemConfig {
  baseDir: string;          // default: '/tmp/fx-nodes'
  autoSync: boolean;        // default: true
  watchChanges: boolean;    // default: true
  fileExtension: string;    // default: '.fxval'
  metadataFile: string;     // default: '.fxmeta'
  syncInterval: number;     // default: 1000 (ms)
  maxFileSize: number;      // default: 10MB
  backupEnabled: boolean;   // default: true
  backupInterval: number;   // default: 300000 (ms)
  backupRetention: number;  // default: 5
  useRamDisk: boolean;      // default: true
  debounceDelay: number;    // default: 100 (ms)
}
```

## Cross-language IPC

The file format is intentionally simple JSON so any language can participate:

- **Rust** reads/writes `.fxmeta` and `.fxval` files
- **Python** can watch the directory with `watchdog` and parse the JSON
- **Go** can use `fsnotify` for the same purpose

The nanosecond timestamp in metadata ensures consistent ordering across implementations.
