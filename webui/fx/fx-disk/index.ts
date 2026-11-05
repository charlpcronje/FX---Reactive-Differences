// fx-disk/index.ts
/**
 * FXDisk WASM Smart Client
 * 
 * Zero-latency synchronous module loading with:
 * - Compressed virtual filesystem
 * - 4KB chunk-level deduplication
 * - LZ4 streaming decompression
 * - Adaptive frame-based downloading
 * - Hot shard real-time updates
 * - Direct FXNode import
 */

// Core exports
export { FXDiskClient, getFXDiskClient, resetFXDiskClient, FXDiskClientConfig } from './fx-disk-client.js';
export { VirtualFileSystem } from './fx-disk-vfs.js';
export { ChunkManager } from './fx-disk-chunks.js';
export { StreamingLoader, StreamStats, StreamCallback } from './fx-disk-streaming.js';
export { HotShardHandler, HotShardConfig, ShardConnectionState } from './fx-disk-hotshard.js';
export { LZ4Decompressor, lz4Compress, lz4CompressFrame } from './fx-disk-lz4.js';
export { FXDiskLogger, logger, LogLevel } from './fx-disk-logger.js';

// Types
export {
    DiskState,
    ChunkHash,
    VFSFileEntry,
    ChunkEntry,
    BundleManifest,
    HotShard,
    PatchInstruction,
    FXNodeUpdate,
    StreamingConfig,
    LoaderStats,
    DiskEvent,
    DiskEventType,
    DiskEventHandler,
    CHUNK_SIZE,
    DEFAULT_STREAMING_CONFIG,
} from './fx-disk-types.js';

// Minimal loader
export * as fxLoad from './fx-load.js';
export { load, read, exists, list, clear, stats, loadBundle, loadBundleBase64, loadBundleSync, createFXLoader } from './fx-load.js';

// FX Integration
export {
    FXDiskModuleLoader,
    patchFXWithDisk,
    createFXDiskIntegration,
    loadFXFromDisk,
    initFXDisk,
    initFXDiskBase64,
} from './fx-disk-integration.js';

// Drop-in SyncModuleLoader replacement for fx.ts
export { FXDiskSyncLoader, FXDiskSyncLoaderConfig } from './fx-sync-loader.js';

// Plugin loader with @ syntax support
export {
    PluginLoader,
    parsePluginSpec,
    patchFXWithPluginLoader,
    $plugin,
    PluginLoadOptions,
    PluginModuleSpec
} from './fx-plugin-loader.js';

// Bundle builder
export {
    BundleBuilder,
    createBundle,
    BundleConfig,
    FileEntry
} from './fx-bundle-builder.js';

// Default export - the minimal loader
import fxLoadDefault from './fx-load.js';
export default fxLoadDefault;
