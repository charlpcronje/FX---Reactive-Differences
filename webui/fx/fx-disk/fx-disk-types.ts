// fx-disk/fx-disk-types.ts
/**
 * FXDisk WASM Smart Client - Core Types & Interfaces
 */

/** 4KB chunk size for deduplication */
export const CHUNK_SIZE = 4096;

/** State machine states */
export enum DiskState {
    UNMOUNTED = 'UNMOUNTED',
    BUNDLED_READY = 'BUNDLED_READY',
    STREAMING = 'STREAMING',
    DECOMPRESSING = 'DECOMPRESSING',
    PATCHING = 'PATCHING',
    READY = 'READY',
}

/** Chunk hash type (SHA-256 truncated to 16 bytes hex = 32 chars) */
export type ChunkHash = string;

/** File entry in the VFS index */
export interface VFSFileEntry {
    path: string;
    chunks: ChunkHash[];
    size: number;
    compression: 'lz4' | 'none';
    contentType: string;
}

/** Chunk table entry */
export interface ChunkEntry {
    hash: ChunkHash;
    data: Uint8Array;
    refCount: number;
}

/** Bundle manifest */
export interface BundleManifest {
    version: string;
    created: string;
    files: VFSFileEntry[];
    chunkCount: number;
    totalSize: number;
    compressedSize: number;
}

/** Hot shard delta update */
export interface HotShard {
    id: string;
    timestamp: number;
    newChunks: Map<ChunkHash, Uint8Array>;
    patchInstructions: PatchInstruction[];
    fxNodeUpdates?: FXNodeUpdate[];
}

/** Patch instruction for updating files */
export interface PatchInstruction {
    path: string;
    action: 'add' | 'replace' | 'delete';
    chunkIndices?: number[];
    newChunks?: ChunkHash[];
    newMetadata?: Partial<VFSFileEntry>;
}

/** FXNode update from hot shard */
export interface FXNodeUpdate {
    path: string;
    operation: 'set' | 'merge' | 'delete';
    value?: unknown;
}

/** Streaming loader configuration */
export interface StreamingConfig {
    initialChunkSize: number;
    maxChunkSize: number;
    minChunkSize: number;
    targetFrameTime: number;  // ms per frame budget
    adaptiveEnabled: boolean;
}

/** Loader statistics */
export interface LoaderStats {
    state: DiskState;
    filesLoaded: number;
    chunksLoaded: number;
    chunksDeduped: number;
    bytesDownloaded: number;
    bytesDecompressed: number;
    compressionRatio: number;
    avgChunkTime: number;
}

/** WASM VFS interface */
export interface WasmVFS {
    add_chunk(hash: string, data: Uint8Array): boolean;
    get_chunk(hash: string): Uint8Array | null;
    has_chunk(hash: string): boolean;
    add_file(path: string, chunks: string[], size: number, compression: string): void;
    read_file(path: string): Uint8Array;
    read_file_string(path: string): string;
    exists(path: string): boolean;
    list_files(): string[];
    file_count(): number;
    chunk_count(): number;
    dedup_count(): number;
    export_bundle(): Uint8Array;
    import_bundle(data: Uint8Array): number;
    apply_patch(patch: Uint8Array): number;
    get_stats(): string;
    free(): void;
}

/** Event types for the Smart Client */
export type DiskEventType = 
    | 'stateChange'
    | 'progress'
    | 'fileReady'
    | 'hotShard'
    | 'error';

export interface DiskEvent {
    type: DiskEventType;
    state?: DiskState;
    progress?: number;
    path?: string;
    error?: Error;
    shard?: HotShard;
}

export type DiskEventHandler = (event: DiskEvent) => void;

/** Default streaming config */
export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
    initialChunkSize: 16384,    // 16KB initial
    maxChunkSize: 262144,       // 256KB max
    minChunkSize: 4096,         // 4KB min
    targetFrameTime: 8,         // 8ms per frame (120fps budget)
    adaptiveEnabled: true,
};
