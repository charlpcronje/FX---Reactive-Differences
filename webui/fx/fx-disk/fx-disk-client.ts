// fx-disk/fx-disk-client.ts
/**
 * FXDisk WASM Smart Client - Main Client Class
 * State machine driven client with full VFS integration
 */

import {
    DiskState,
    DiskEvent,
    DiskEventHandler,
    LoaderStats,
    StreamingConfig,
    DEFAULT_STREAMING_CONFIG,
    FXNodeUpdate,
} from './fx-disk-types.js';
import { VirtualFileSystem } from './fx-disk-vfs.js';
import { StreamingLoader } from './fx-disk-streaming.js';
import { HotShardHandler, HotShardConfig, ShardConnectionState } from './fx-disk-hotshard.js';
import { LZ4Decompressor } from './fx-disk-lz4.js';
import { logger, LogLevel } from './fx-disk-logger.js';

/** Client configuration */
export interface FXDiskClientConfig {
    streaming?: Partial<StreamingConfig>;
    hotShard?: Partial<HotShardConfig>;
    logLevel?: LogLevel;
    autoConnect?: boolean;
}

/** Module execution context */
interface ModuleContext {
    exports: Record<string, unknown>;
    module: { exports: Record<string, unknown> };
    require: (path: string) => unknown;
}

export class FXDiskClient {
    private state: DiskState = DiskState.UNMOUNTED;
    private vfs: VirtualFileSystem;
    private streamer: StreamingLoader;
    private hotShard: HotShardHandler;
    private decompressor: LZ4Decompressor;
    private eventHandlers: DiskEventHandler[] = [];
    private moduleCache = new Map<string, unknown>();
    private stats: LoaderStats;

    constructor(config: FXDiskClientConfig = {}) {
        if (config.logLevel !== undefined) {
            logger.setLevel(config.logLevel);
        }

        this.vfs = new VirtualFileSystem();
        this.streamer = new StreamingLoader(config.streaming);
        this.hotShard = new HotShardHandler(this.vfs, config.hotShard);
        this.decompressor = new LZ4Decompressor();
        this.stats = this.createEmptyStats();

        // Forward events
        this.streamer.on(e => this.emit(e));
        this.hotShard.on(e => this.emit(e));

        // Auto-connect to hot shard if configured
        if (config.autoConnect && config.hotShard?.serverUrl) {
            this.hotShard.connect();
        }

        logger.info('FXDisk Client initialized');
    }

    private createEmptyStats(): LoaderStats {
        return {
            state: DiskState.UNMOUNTED,
            filesLoaded: 0,
            chunksLoaded: 0,
            chunksDeduped: 0,
            bytesDownloaded: 0,
            bytesDecompressed: 0,
            compressionRatio: 1,
            avgChunkTime: 0,
        };
    }

    /** Subscribe to events */
    on(handler: DiskEventHandler): () => void {
        this.eventHandlers.push(handler);
        return () => {
            const idx = this.eventHandlers.indexOf(handler);
            if (idx >= 0) this.eventHandlers.splice(idx, 1);
        };
    }

    /** Subscribe to FXNode updates from hot shards */
    onNodeUpdate(callback: (update: FXNodeUpdate) => void): () => void {
        return this.hotShard.onNodeUpdate(callback);
    }

    private emit(event: DiskEvent): void {
        for (const handler of this.eventHandlers) {
            try {
                handler(event);
            } catch (e) {
                logger.error('Event handler error', e);
            }
        }
    }

    private setState(newState: DiskState): void {
        if (this.state !== newState) {
            logger.debug(`State: ${this.state} -> ${newState}`);
            this.state = newState;
            this.stats.state = newState;
            this.emit({ type: 'stateChange', state: newState });
        }
    }

    /** Get current state */
    getState(): DiskState {
        return this.state;
    }

    /** Load bundle from URL */
    async loadBundle(url: string): Promise<number> {
        this.setState(DiskState.STREAMING);

        const chunks: Uint8Array[] = [];
        
        await this.streamer.stream(url, (chunk, done) => {
            if (chunk.length > 0) {
                chunks.push(chunk);
                this.stats.bytesDownloaded += chunk.length;
            }
            
            if (done) {
                this.setState(DiskState.DECOMPRESSING);
            }
        });

        // Combine chunks
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        // Import bundle
        const count = this.vfs.importBundle(combined);
        this.updateStats();
        
        this.setState(DiskState.READY);
        logger.info(`Bundle loaded: ${count} files`);
        
        return count;
    }

    /** Load bundle from base64 string */
    async loadBundleBase64(base64: string): Promise<number> {
        this.setState(DiskState.STREAMING);

        const chunks: Uint8Array[] = [];
        
        await this.streamer.streamFromBase64(base64, (chunk, done) => {
            if (chunk.length > 0) {
                chunks.push(chunk);
            }
            if (done) {
                this.setState(DiskState.DECOMPRESSING);
            }
        });

        // Combine and import
        const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }

        const count = this.vfs.importBundle(combined);
        this.updateStats();
        
        this.setState(DiskState.READY);
        return count;
    }

    /** Load bundle synchronously (for embedded bundles) */
    loadBundleSync(data: Uint8Array): number {
        this.setState(DiskState.DECOMPRESSING);
        const count = this.vfs.importBundle(data);
        this.updateStats();
        this.setState(DiskState.READY);
        return count;
    }

    /** Read file as string - SYNCHRONOUS */
    readFileSync(path: string): string {
        if (this.state === DiskState.UNMOUNTED) {
            throw new Error('VFS not mounted');
        }
        return this.vfs.readFileString(path);
    }

    /** Read file as bytes - SYNCHRONOUS */
    readFileBytesSync(path: string): Uint8Array {
        if (this.state === DiskState.UNMOUNTED) {
            throw new Error('VFS not mounted');
        }
        return this.vfs.readFile(path);
    }

    /** Check if file exists */
    exists(path: string): boolean {
        return this.vfs.exists(path);
    }

    /** List all files */
    listFiles(): string[] {
        return this.vfs.listFiles();
    }

    /** Load and execute module - SYNCHRONOUS */
    loadModuleSync(path: string): unknown {
        // Check cache
        const cacheKey = this.normalizePath(path);
        if (this.moduleCache.has(cacheKey)) {
            return this.moduleCache.get(cacheKey);
        }

        const code = this.readFileSync(path);
        const result = this.executeModule(code, path);
        
        this.moduleCache.set(cacheKey, result);
        this.emit({ type: 'fileReady', path });
        
        return result;
    }

    private executeModule(code: string, path: string): unknown {
        // Transform export syntax
        const transformed = code
            .replace(/export\s+default\s+/g, 'module.exports.default = ')
            .replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ')
            .replace(/\bexport\s+\{[^}]+\}/g, '');

        const context: ModuleContext = {
            exports: {},
            module: { exports: {} },
            require: (depPath: string) => {
                const resolved = this.resolvePath(depPath, path);
                return this.loadModuleSync(resolved);
            },
        };

        try {
            const fn = new Function(
                'module', 'exports', 'require',
                transformed
            );
            fn.call(context.exports, context.module, context.exports, context.require);
            return context.module.exports.default ?? context.module.exports;
        } catch (err) {
            logger.error(`Module execution failed: ${path}`, err);
            throw err;
        }
    }

    private resolvePath(importPath: string, fromPath: string): string {
        if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
            return importPath;
        }

        const base = fromPath.substring(0, fromPath.lastIndexOf('/'));
        const parts = `${base}/${importPath}`.split('/');
        const result: string[] = [];

        for (const part of parts) {
            if (part === '' || part === '.') continue;
            if (part === '..') result.pop();
            else result.push(part);
        }

        return result.join('/');
    }

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    }

    /**
     * Stream a file directly into VFS with UI-friendly yielding
     * This is called by FXDiskSyncLoader when a file is missing from VFS
     */
    async streamIntoVFS(url: string): Promise<void> {
        const chunks: Uint8Array[] = [];

        // Stream the file with chunk callback
        await this.streamer.streamFile(url, (chunk) => {
            chunks.push(chunk);
        });

        // Reconstruct complete file
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const completeData = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            completeData.set(chunk, offset);
            offset += chunk.length;
        }

        // Add to VFS
        const normalized = this.normalizePath(url);
        this.vfs.addFile(normalized, completeData);

        logger.debug(`Streamed into VFS: ${url} (${totalLength} bytes)`);
    }

    /** Add file to VFS */
    addFile(path: string, content: string | Uint8Array): void {
        if (typeof content === 'string') {
            this.vfs.addFileString(path, content);
        } else {
            this.vfs.addFile(path, content);
        }
        this.updateStats();
    }

    /** Export current VFS as bundle */
    exportBundle(): Uint8Array {
        return this.vfs.exportBundle();
    }

    /** Connect to hot shard server */
    connectHotShard(serverUrl?: string): void {
        this.hotShard.connect(serverUrl);
    }

    /** Disconnect from hot shard server */
    disconnectHotShard(): void {
        this.hotShard.disconnect();
    }

    /** Check if hot shard is connected */
    isHotShardConnected(): boolean {
        return this.hotShard.getState() === ShardConnectionState.CONNECTED;
    }

    private updateStats(): void {
        const vfsStats = this.vfs.getStats();
        const streamStats = this.streamer.getStats();
        
        this.stats.filesLoaded = vfsStats.files;
        this.stats.chunksLoaded = vfsStats.chunks;
        this.stats.chunksDeduped = vfsStats.dedups;
        this.stats.compressionRatio = vfsStats.ratio;
        this.stats.avgChunkTime = streamStats.avgChunkTime;
    }

    /** Get current statistics */
    getStats(): LoaderStats {
        this.updateStats();
        return { ...this.stats };
    }

    /** Clear module cache */
    clearCache(): void {
        this.moduleCache.clear();
    }

    /** Reset to unmounted state */
    reset(): void {
        this.vfs.clear();
        this.moduleCache.clear();
        this.stats = this.createEmptyStats();
        this.setState(DiskState.UNMOUNTED);
    }

    /** Destroy client */
    destroy(): void {
        this.hotShard.disconnect();
        this.reset();
        this.eventHandlers = [];
        logger.info('FXDisk Client destroyed');
    }
}

// Singleton instance
let clientInstance: FXDiskClient | null = null;

/** Get or create the singleton client */
export function getFXDiskClient(config?: FXDiskClientConfig): FXDiskClient {
    if (!clientInstance) {
        clientInstance = new FXDiskClient(config);
    }
    return clientInstance;
}

/** Reset the singleton */
export function resetFXDiskClient(): void {
    if (clientInstance) {
        clientInstance.destroy();
        clientInstance = null;
    }
}
