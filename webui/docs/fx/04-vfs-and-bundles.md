# Virtual File System & Bundles

FX uses a chunk-based Virtual File System (VFS) to store, compress, deduplicate, and bundle files. The VFS is the backbone of FX's serialization, persistence, and distribution systems.

---

## Architecture Overview

```
 FX Node Tree
      |
      v
 SerializePlugin          FilesystemPlugin
   wrap() / expand()        sync_node_to_disk()
   to_json() / to_msgpack() export_snapshot()
      |                         |
      v                         v
 VirtualFileSystem          Disk (per-node dirs)
   write_file()
   read_file()
      |
      v
 ChunkManager
   split_into_chunks()    4KB chunks
   assemble_chunks()      SHA-256 dedup
      |                   LZ4 compression
      v
 FXB Binary Bundle
   export_bundle()
   import_bundle()
      |
      v
 Relay / Network
   hot shard delta updates
```

---

## ChunkManager: Split, Assemble, Dedup

All data flowing into the VFS is split into **4KB chunks** (matching the TypeScript `CHUNK_SIZE`). Each chunk is hashed and deduplicated.

### Constants

| Constant | Value | Description |
|---|---|---|
| `CHUNK_SIZE` | 4096 bytes | Fixed chunk size |
| `FXB_MAGIC` | `FXB\0` | Bundle file magic bytes |
| `FXB_VERSION` | 1 | Current bundle format version |

### How Chunking Works

1. Input data is sliced into 4096-byte segments (the last segment may be smaller).
2. Each segment is hashed to produce a 32-hex-character content hash.
3. If the hash already exists in the chunk table, the reference count is incremented (deduplication).
4. If the hash is new, the chunk data is stored.

```rust
let cm = ChunkManager::new();

// Split a file into chunks
let data = fs::read("large_file.bin")?;
let hashes: Vec<ChunkHash> = cm.split_into_chunks(&data);

// Reassemble later
let reassembled: Vec<u8> = cm.assemble_chunks(&hashes).unwrap();
assert_eq!(data, reassembled);

// Deduplication happens automatically
let h1 = cm.add_chunk(vec![42u8; 100]);
let h2 = cm.add_chunk(vec![42u8; 100]);
assert_eq!(h1, h2);
assert_eq!(cm.chunk_count(), 1);   // only one copy stored
assert_eq!(cm.dedup_count(), 1);   // one dedup event
```

### ChunkManager API

| Method | Description |
|---|---|
| `add_chunk(data) -> ChunkHash` | Store a chunk, returning its hash. Deduplicates automatically. |
| `add_chunk_with_hash(hash, data) -> bool` | Store with a known hash (e.g., from bundle import). Returns `true` if new. |
| `get_chunk(hash) -> Option<Vec<u8>>` | Retrieve chunk data by hash. |
| `has_chunk(hash) -> bool` | Check existence. |
| `split_into_chunks(data) -> Vec<ChunkHash>` | Split data into 4KB chunks, store each, return hash list. |
| `assemble_chunks(hashes) -> Option<Vec<u8>>` | Reassemble original data from hash list. |
| `chunk_count() -> usize` | Number of unique chunks stored. |
| `dedup_count() -> usize` | Number of deduplication events. |

---

## LZ4 Compression

Chunks larger than 256 bytes are compressed with LZ4. Chunks of 256 bytes or fewer are stored uncompressed (the compression overhead is not worth it at that size).

The compressed format uses a leading marker byte:

| Marker | Meaning | Layout |
|---|---|---|
| `0x00` | Uncompressed | `[0x00][raw data...]` |
| `0x01` | Compressed | `[0x01][original_length: u32 LE][compressed data...]` |

If compression does not reduce the size, the data is stored uncompressed regardless of size.

```rust
// Small data: no compression
let small = vec![1, 2, 3];
let compressed = compress_lz4(&small);
assert_eq!(compressed[0], 0); // uncompressed marker

// Large repetitive data: compressed
let large = vec![42u8; 1000];
let compressed = compress_lz4(&large);
assert!(compressed.len() < large.len());

// Always roundtrips
let decompressed = decompress_lz4(&compressed).unwrap();
assert_eq!(decompressed, large);
```

---

## VirtualFileSystem

The `VirtualFileSystem` wraps `ChunkManager` and provides a file-level API.

### Core API

| Method | Description |
|---|---|
| `write_file(path, data, content_type)` | Write data to a virtual path. Compresses if > 256 bytes. |
| `read_file(path) -> Option<Vec<u8>>` | Read and decompress file data. |
| `read_file_string(path) -> Option<String>` | Read as UTF-8 string. |
| `exists(path) -> bool` | Check if a virtual path exists. |
| `list_files() -> Vec<String>` | List all virtual paths. |
| `file_count() -> usize` | Number of files stored. |
| `state() -> DiskState` | Current state machine state. |
| `stats() -> LoaderStats` | Loading statistics. |

### Usage

```rust
let vfs = VirtualFileSystem::new();

// Write files
vfs.write_file("app.ts", b"export const x = 42;", "application/javascript");
vfs.write_file("config.json", b"{\"debug\": true}", "application/json");

// Read back
let code = vfs.read_file_string("app.ts").unwrap();
assert_eq!(code, "export const x = 42;");

// Check existence
assert!(vfs.exists("app.ts"));
assert!(!vfs.exists("missing.ts"));
```

### VFS File Entry

Each file in the VFS is tracked by a `VFSFileEntry`:

```rust
pub struct VFSFileEntry {
    pub path: String,             // Virtual path
    pub chunks: Vec<ChunkHash>,   // Ordered list of chunk hashes
    pub size: usize,              // Original (uncompressed) size
    pub compression: Compression, // None or Lz4
    pub content_type: String,     // MIME type (auto-detected from extension)
}
```

Content types are auto-detected:

| Extension | Content Type |
|---|---|
| `.ts`, `.js` | `application/javascript` |
| `.json` | `application/json` |
| `.html` | `text/html` |
| `.css` | `text/css` |
| `.wasm` | `application/wasm` |
| Other | `application/octet-stream` |

---

## FXB Binary Bundle Format

The FXB format packs all VFS files into a single binary blob for transport or storage.

### Binary Layout

```
Offset  Size     Field
─────────────────────────────────────
0       4        Magic: "FXB\0" (0x46 0x58 0x42 0x00)
4       2        Version: u16 LE (currently 1)
6       4        FileCount: u32 LE

For each file:
  +0    2        PathLen: u16 LE
  +2    N        Path: UTF-8 bytes (N = PathLen)
  +N+2  4        DataLen: u32 LE
  +N+6  1        Compressed: u8 (0 = none, 1 = LZ4)
  +N+7  M        Data: raw bytes (M = DataLen)
```

### Export and Import

```rust
let vfs = VirtualFileSystem::new();
vfs.write_file("hello.ts", b"export const x = 42;", "application/javascript");
vfs.write_file("world.json", b"{\"a\": 1}", "application/json");

// Export to bytes
let bundle: Vec<u8> = vfs.export_bundle();
assert_eq!(&bundle[0..4], b"FXB\0");

// Import into a new VFS
let vfs2 = VirtualFileSystem::new();
let loaded = vfs2.import_bundle(&bundle).unwrap();
assert_eq!(loaded, 2);
assert_eq!(vfs2.read_file_string("hello.ts").unwrap(), "export const x = 42;");
```

After import, the VFS transitions to `DiskState::BundledReady`.

---

## State Machine

The VFS tracks its lifecycle through a state machine:

```
Unmounted --> BundledReady --> Streaming --> Decompressing --> Patching --> Ready
                  ^                                              |
                  |______________________________________________|
                              (apply_hot_shard)
```

| State | Meaning |
|---|---|
| `Unmounted` | Initial state. No data loaded. |
| `BundledReady` | A bundle has been imported. Files are available. |
| `Streaming` | Data is being streamed in progressively. |
| `Decompressing` | Chunks are being decompressed. |
| `Patching` | A hot shard delta update is being applied. |
| `Ready` | All data loaded and available. |

---

## Hot Shard Delta Updates

After the initial bundle load, the VFS supports incremental updates via **hot shards**. A hot shard contains new chunks and patch instructions that modify the file index without re-transmitting the entire bundle.

### HotShard Structure

```rust
pub struct HotShard {
    pub id: String,                                  // Shard identifier
    pub timestamp_ns: u64,                           // Nanosecond timestamp
    pub new_chunks: HashMap<ChunkHash, Vec<u8>>,     // New chunk data
    pub patch_instructions: Vec<PatchInstruction>,   // File-level patches
    pub fx_node_updates: Vec<FXNodeUpdate>,          // Node tree updates
}
```

### PatchInstruction

Each instruction targets a file path with an action:

| Action | Description |
|---|---|
| `Add` | Insert a new file. Requires `new_metadata`. |
| `Replace` | Replace chunks in an existing file. Uses `chunk_indices` + `new_chunks`, or full `new_metadata`. |
| `Delete` | Remove a file from the VFS. |

```rust
PatchInstruction {
    path: "app.ts".to_string(),
    action: PatchAction::Replace,
    chunk_indices: Some(vec![0]),      // Replace first chunk only
    new_chunks: Some(vec![new_hash]),  // With this new chunk
    new_metadata: None,
}
```

### FXNodeUpdate

Hot shards can also carry node tree mutations:

```rust
pub struct FXNodeUpdate {
    pub path: String,                  // Node path (e.g., "app.settings.theme")
    pub operation: NodeUpdateOp,       // Set, Merge, or Delete
    pub value: Option<FXValue>,        // New value (for Set/Merge)
}
```

### Applying a Hot Shard

```rust
let shard = HotShard {
    id: "shard-1".to_string(),
    timestamp_ns: now_ns(),
    new_chunks: HashMap::from([(hash, data)]),
    patch_instructions: vec![
        PatchInstruction {
            path: "app.ts".to_string(),
            action: PatchAction::Replace,
            chunk_indices: None,
            new_chunks: Some(vec![hash]),
            new_metadata: None,
        }
    ],
    fx_node_updates: vec![],
};

let patched_count = vfs.apply_hot_shard(&shard).unwrap();
assert_eq!(vfs.state(), DiskState::Ready);
```

---

## Serialization: SerializePlugin

`SerializePlugin` converts the FX node tree to and from portable formats. It bridges the live tree and the VFS.

### Core Operations

| Method | Direction | Format |
|---|---|---|
| `wrap(node)` | Tree -> `SerializedState` | In-memory struct |
| `expand(state, target)` | `SerializedState` -> Tree | In-memory struct |
| `to_json(node)` | Tree -> String | JSON |
| `from_json(json, target)` | String -> Tree | JSON |
| `to_msgpack(node)` | Tree -> Bytes | MessagePack binary |
| `from_msgpack(data, target)` | Bytes -> Tree | MessagePack binary |
| `to_fxb(node)` | Tree -> Bytes | FXB bundle (JSON + MsgPack inside VFS) |
| `from_fxb(data, target)` | Bytes -> Tree | FXB bundle |

### SerializedNode Format

Each node serializes to:

```json
{
    "__id": "$.app.settings",
    "__parent_id": "$.app",
    "__type": null,
    "__proto": [],
    "__value": 42,
    "__bag": {
        "entries": {
            "raw": 42,
            "num": 42,
            "string": "42",
            "boolean": true
        }
    },
    "__nodes": { ... },
    "__watchers_count": 2
}
```

The `__bag` field preserves the full `FXValueBag` with all pre-computed coercions, enabling observability and debugging without re-evaluation.

### FXB Bundles via SerializePlugin

`to_fxb()` writes both JSON and MessagePack representations into a VFS, then exports the VFS as an FXB bundle. `from_fxb()` imports the bundle and prefers the MessagePack payload for speed, falling back to JSON:

```rust
let serializer = SerializePlugin::new(logger, SerializeOptions::default());

// Export
let bundle_bytes = serializer.to_fxb(&fx.root())?;

// Import (prefers msgpack, falls back to json)
serializer.from_fxb(&bundle_bytes, &fx2.root())?;
```

### Serialization Options

```rust
pub struct SerializeOptions {
    pub include_private: bool,        // Include keys starting with '_' (default: false)
    pub max_depth: usize,             // Max tree depth (default: 50)
    pub include_watchers_meta: bool,  // Include watcher counts (default: true)
}
```

### Safety: Circular References and Depth Limits

The serializer tracks visited node IDs. If it encounters a node it has already visited, it emits a `__fx_circular_reference` marker instead of recursing. If depth exceeds `max_depth`, it emits `__fx_max_depth_exceeded: true`.

---

## FilesystemPlugin: Disk Persistence

`FilesystemPlugin` persists individual FX nodes to disk as files, with a background sync worker.

### Configuration

```rust
FilesystemConfig {
    base_dir: PathBuf::from("/tmp/fx-nodes"),
    auto_sync: true,               // Enable background sync worker
    watch_changes: true,            // Watch for changes via structure events
    file_extension: ".fxval",       // JSON value file extension
    metadata_file: ".fxmeta",      // Metadata filename
    sync_interval: Duration::from_secs(1),
    max_file_size: 10 * 1024 * 1024,  // 10 MB limit
    backup_enabled: true,
    backup_interval: Duration::from_secs(300),
    backup_retention: 5,
    use_binary_serialization: false,   // true = bincode (.fxbin)
    binary_extension: ".fxbin",
}
```

### Per-Node Disk Layout

Each node gets a directory under `base_dir`:

```
/tmp/fx-nodes/
  $_app_settings/
    .fxmeta              <- NodeMetadata JSON
    value.fxval          <- Value bag as JSON (or value.fxbin for binary)
    $_app_settings_theme/
      .fxmeta
      value.fxval
```

### Sync Worker

When `auto_sync` is enabled, a background thread polls every `sync_interval`:

1. Structure events (`ValueChanged`, `NodeCreated`) enqueue node paths into a `HashSet<String>`.
2. The sync worker drains the queue each interval.
3. For each queued node, it resolves the node in the FX tree, writes metadata and value to disk.

### Snapshot Export/Import

```rust
let fs_plugin = FilesystemPlugin::new(config, logger);

// Export entire tree as a single JSON snapshot
let path = fs_plugin.export_snapshot("v1.0")?;
// -> /tmp/fx-nodes/v1.0.fxsnap.json

// Import a snapshot
fs_plugin.import_snapshot("/tmp/fx-nodes/v1.0.fxsnap.json")?;

// Export/import as FXB bundle
let bundle = fs_plugin.export_fxb_bundle()?;
fs_plugin.import_fxb_bundle(&bundle)?;
```

---

## How It All Connects

The full pipeline from a value change to network distribution:

```
1. $$("app.name").set("Alice")
       |
2. FX tree node updated, structure event fires
       |
3. FilesystemPlugin enqueues "app.name" for disk sync
       |
4. SerializePlugin.wrap() captures the tree state
       |
5. SerializePlugin.to_fxb() writes state into VFS
       |  - state.json   (JSON representation)
       |  - state.msgpack (MessagePack representation)
       |
6. VFS.export_bundle() packs files into FXB binary
       |  - 4KB chunk deduplication
       |  - LZ4 compression for chunks > 256 bytes
       |  - FXB header + file entries
       |
7. Relay broadcasts delta patches to subscribed clients
       |  - Hot shard for VFS-level updates
       |  - FXDeltaPatch for individual value changes
```

### Boot Sequence

When an FX application starts:

```
1. mount VFS      <- Import FXB bundle (base64, URL, or disk)
2. read manifest  <- Parse __fx_manifest__.json from VFS
3. install stubs  <- Create lazy-loading function stubs for features
4. lazy-load      <- Features load on first access from VFS chunks
5. Ready          <- VFS state -> Ready
```

```typescript
import { boot } from "./fx-boot";

const { fx, $$ } = boot({
    bundleUrl: "./app.fxb",    // Loads FXB, mounts VFS, reads manifest
});

// Features and plugins load lazily from VFS on first use
$$("app.name").set("Hello");
```
