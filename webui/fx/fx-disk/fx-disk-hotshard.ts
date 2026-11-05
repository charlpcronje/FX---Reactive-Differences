// fx-disk/fx-disk-hotshard.ts
/**
 * FXDisk WASM Smart Client - Hot Shard Handler
 * Real-time delta updates from server
 */

import { HotShard, PatchInstruction, FXNodeUpdate, ChunkHash, DiskEvent, DiskEventHandler } from './fx-disk-types.js';
import { VirtualFileSystem } from './fx-disk-vfs.js';
import { logger } from './fx-disk-logger.js';

/** Hot shard connection state */
export enum ShardConnectionState {
    DISCONNECTED = 'DISCONNECTED',
    CONNECTING = 'CONNECTING',
    CONNECTED = 'CONNECTED',
    RECONNECTING = 'RECONNECTING',
}

/** Hot shard configuration */
export interface HotShardConfig {
    serverUrl: string;
    reconnectDelay: number;
    maxReconnectAttempts: number;
    heartbeatInterval: number;
}

const DEFAULT_CONFIG: HotShardConfig = {
    serverUrl: '',
    reconnectDelay: 1000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000,
};

export class HotShardHandler {
    private config: HotShardConfig;
    private vfs: VirtualFileSystem;
    private ws: WebSocket | null = null;
    private state = ShardConnectionState.DISCONNECTED;
    private reconnectAttempts = 0;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private pendingShards: HotShard[] = [];
    private eventHandlers: DiskEventHandler[] = [];
    private nodeUpdateCallbacks: ((update: FXNodeUpdate) => void)[] = [];

    constructor(vfs: VirtualFileSystem, config: Partial<HotShardConfig> = {}) {
        this.vfs = vfs;
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /** Subscribe to events */
    on(handler: DiskEventHandler): () => void {
        this.eventHandlers.push(handler);
        return () => {
            const idx = this.eventHandlers.indexOf(handler);
            if (idx >= 0) this.eventHandlers.splice(idx, 1);
        };
    }

    /** Subscribe to FXNode updates */
    onNodeUpdate(callback: (update: FXNodeUpdate) => void): () => void {
        this.nodeUpdateCallbacks.push(callback);
        return () => {
            const idx = this.nodeUpdateCallbacks.indexOf(callback);
            if (idx >= 0) this.nodeUpdateCallbacks.splice(idx, 1);
        };
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

    /** Connect to hot shard server */
    connect(serverUrl?: string): void {
        if (serverUrl) {
            this.config.serverUrl = serverUrl;
        }

        if (!this.config.serverUrl) {
            logger.warn('No hot shard server URL configured');
            return;
        }

        if (this.state === ShardConnectionState.CONNECTED || 
            this.state === ShardConnectionState.CONNECTING) {
            return;
        }

        this.state = ShardConnectionState.CONNECTING;
        logger.info('Connecting to hot shard server', this.config.serverUrl);

        try {
            this.ws = new WebSocket(this.config.serverUrl);
            this.setupWebSocket();
        } catch (err) {
            logger.error('WebSocket connection failed', err);
            this.scheduleReconnect();
        }
    }

    private setupWebSocket(): void {
        if (!this.ws) return;

        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            this.state = ShardConnectionState.CONNECTED;
            this.reconnectAttempts = 0;
            logger.info('Connected to hot shard server');
            this.startHeartbeat();
            
            // Process any pending shards
            this.processPendingShards();
        };

        this.ws.onmessage = (event) => {
            this.handleMessage(event.data);
        };

        this.ws.onerror = (event) => {
            logger.error('WebSocket error', event);
        };

        this.ws.onclose = () => {
            this.state = ShardConnectionState.DISCONNECTED;
            this.stopHeartbeat();
            logger.info('Disconnected from hot shard server');
            this.scheduleReconnect();
        };
    }

    private handleMessage(data: ArrayBuffer | string): void {
        try {
            let shard: HotShard;

            if (data instanceof ArrayBuffer) {
                shard = this.parseShardBinary(new Uint8Array(data));
            } else {
                shard = JSON.parse(data);
                // Convert chunk map from object to Map
                if (shard.newChunks && !(shard.newChunks instanceof Map)) {
                    shard.newChunks = new Map(Object.entries(shard.newChunks as object));
                }
            }

            this.applyShard(shard);
            this.emit({ type: 'hotShard', shard });

        } catch (err) {
            logger.error('Failed to parse hot shard', err);
        }
    }

    private parseShardBinary(data: Uint8Array): HotShard {
        // Binary format: [id:32][timestamp:8][chunkCount:4][chunks...][patchCount:4][patches...]
        const view = new DataView(data.buffer, data.byteOffset);
        const decoder = new TextDecoder();
        let offset = 0;

        // ID (32 bytes, null-terminated string)
        const idBytes = data.subarray(offset, offset + 32);
        const idEnd = idBytes.indexOf(0);
        const id = decoder.decode(idBytes.subarray(0, idEnd > 0 ? idEnd : 32));
        offset += 32;

        // Timestamp
        const timestamp = Number(view.getBigUint64(offset, true));
        offset += 8;

        // Chunks
        const chunkCount = view.getUint32(offset, true);
        offset += 4;

        const newChunks = new Map<ChunkHash, Uint8Array>();
        for (let i = 0; i < chunkCount; i++) {
            // Hash (16 bytes)
            let hash = '';
            for (let j = 0; j < 16; j++) {
                hash += data[offset + j].toString(16).padStart(2, '0');
            }
            offset += 16;

            // Chunk length and data
            const len = view.getUint32(offset, true);
            offset += 4;
            const chunkData = data.subarray(offset, offset + len);
            offset += len;

            newChunks.set(hash, new Uint8Array(chunkData));
        }

        // Patches (JSON)
        const patchLen = view.getUint32(offset, true);
        offset += 4;
        const patchBytes = data.subarray(offset, offset + patchLen);
        const patchInstructions: PatchInstruction[] = JSON.parse(decoder.decode(patchBytes));
        offset += patchLen;

        // FXNode updates (JSON, optional)
        let fxNodeUpdates: FXNodeUpdate[] | undefined;
        if (offset < data.length) {
            const updateLen = view.getUint32(offset, true);
            offset += 4;
            if (updateLen > 0) {
                const updateBytes = data.subarray(offset, offset + updateLen);
                fxNodeUpdates = JSON.parse(decoder.decode(updateBytes));
            }
        }

        return { id, timestamp, newChunks, patchInstructions, fxNodeUpdates };
    }

    /** Apply a hot shard to the VFS */
    applyShard(shard: HotShard): void {
        logger.info(`Applying hot shard: ${shard.id}`);

        // First, add new chunks
        // Note: Chunks are added directly to VFS in a real implementation
        // For now we just track them
        if (shard.newChunks.size > 0) {
            logger.debug(`Adding ${shard.newChunks.size} new chunks`);
        }

        // Apply patch instructions
        for (const patch of shard.patchInstructions) {
            this.applyPatch(patch);
        }

        // Apply FXNode updates
        if (shard.fxNodeUpdates) {
            for (const update of shard.fxNodeUpdates) {
                this.applyNodeUpdate(update);
            }
        }

        logger.info(`Hot shard applied: ${shard.id}`, {
            chunks: shard.newChunks.size,
            patches: shard.patchInstructions.length,
            nodeUpdates: shard.fxNodeUpdates?.length ?? 0,
        });
    }

    private applyPatch(patch: PatchInstruction): void {
        switch (patch.action) {
            case 'add':
            case 'replace':
                // File content is updated via chunks
                logger.debug(`Patch ${patch.action}: ${patch.path}`);
                break;

            case 'delete':
                this.vfs.deleteFile(patch.path);
                logger.debug(`Deleted: ${patch.path}`);
                break;
        }
    }

    private applyNodeUpdate(update: FXNodeUpdate): void {
        for (const callback of this.nodeUpdateCallbacks) {
            try {
                callback(update);
            } catch (e) {
                logger.error('Node update callback error', e);
            }
        }
    }

    private processPendingShards(): void {
        while (this.pendingShards.length > 0) {
            const shard = this.pendingShards.shift()!;
            this.applyShard(shard);
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        this.state = ShardConnectionState.RECONNECTING;
        const delay = this.config.reconnectDelay * this.reconnectAttempts;

        logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect();
        }, delay);
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, this.config.heartbeatInterval);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /** Disconnect from server */
    disconnect(): void {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.state = ShardConnectionState.DISCONNECTED;
    }

    /** Get connection state */
    getState(): ShardConnectionState {
        return this.state;
    }

    /** Check if connected */
    isConnected(): boolean {
        return this.state === ShardConnectionState.CONNECTED;
    }
}
