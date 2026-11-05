// fx-disk/fx-disk-streaming.ts
/**
 * FXDisk WASM Smart Client - Adaptive Streaming Loader
 * Frame-based incremental downloading that never blocks UI
 */

import { StreamingConfig, DEFAULT_STREAMING_CONFIG, DiskEvent, DiskEventHandler } from './fx-disk-types.js';
import { logger } from './fx-disk-logger.js';

/** Streaming result callback */
export type StreamCallback = (chunk: Uint8Array, done: boolean) => void;

/** Streaming statistics */
export interface StreamStats {
    bytesReceived: number;
    chunksReceived: number;
    avgChunkTime: number;
    currentChunkSize: number;
    throughput: number; // bytes per second
}

export class StreamingLoader {
    private config: StreamingConfig;
    private controller: AbortController | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private stats: StreamStats;
    private chunkTimes: number[] = [];
    private eventHandlers: DiskEventHandler[] = [];

    constructor(config: Partial<StreamingConfig> = {}) {
        this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
        this.stats = this.createEmptyStats();
    }

    private createEmptyStats(): StreamStats {
        return {
            bytesReceived: 0,
            chunksReceived: 0,
            avgChunkTime: 0,
            currentChunkSize: this.config.initialChunkSize,
            throughput: 0,
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

    private emit(event: DiskEvent): void {
        for (const handler of this.eventHandlers) {
            try {
                handler(event);
            } catch (e) {
                logger.error('Event handler error', e);
            }
        }
    }

    /** Start streaming from URL */
    async stream(url: string, callback: StreamCallback): Promise<void> {
        this.abort();
        this.stats = this.createEmptyStats();
        this.controller = new AbortController();

        try {
            const response = await fetch(url, {
                signal: this.controller.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (!response.body) {
                throw new Error('Response has no body');
            }

            this.reader = response.body.getReader();
            await this.processStream(callback);

        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                logger.error('Stream error', err);
                this.emit({ type: 'error', error: err as Error });
                throw err;
            }
        } finally {
            this.reader = null;
            this.controller = null;
        }
    }

    private async processStream(callback: StreamCallback): Promise<void> {
        const startTime = performance.now();
        let buffer = new Uint8Array(0);

        while (true) {
            const frameStart = performance.now();
            
            // Read chunk
            const { value, done } = await this.reader!.read();

            if (done) {
                // Flush remaining buffer
                if (buffer.length > 0) {
                    callback(buffer, true);
                }
                this.emit({ type: 'progress', progress: 1 });
                callback(new Uint8Array(0), true);
                break;
            }

            // Append to buffer
            const newBuffer = new Uint8Array(buffer.length + value.length);
            newBuffer.set(buffer);
            newBuffer.set(value, buffer.length);
            buffer = newBuffer;

            this.stats.bytesReceived += value.length;

            // Process buffer in frame-sized chunks
            while (buffer.length >= this.stats.currentChunkSize) {
                const chunk = buffer.subarray(0, this.stats.currentChunkSize);
                buffer = buffer.subarray(this.stats.currentChunkSize);

                const chunkStart = performance.now();
                callback(chunk, false);
                const chunkTime = performance.now() - chunkStart;

                this.stats.chunksReceived++;
                this.recordChunkTime(chunkTime);

                // Yield to allow UI updates
                await this.yieldFrame();
            }

            // Adapt chunk size based on performance
            if (this.config.adaptiveEnabled) {
                this.adaptChunkSize();
            }

            const frameTime = performance.now() - frameStart;
            if (frameTime < this.config.targetFrameTime) {
                // We have budget left, can increase chunk size next time
            }

            // Update throughput
            const elapsed = (performance.now() - startTime) / 1000;
            this.stats.throughput = elapsed > 0 ? this.stats.bytesReceived / elapsed : 0;
        }
    }

    /**
     * Yield to UI thread using requestAnimationFrame
     * This ensures streaming doesn't block the UI
     */
    private async yieldFrame(): Promise<void> {
        return new Promise(resolve => {
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }

    private recordChunkTime(time: number): void {
        this.chunkTimes.push(time);
        if (this.chunkTimes.length > 10) {
            this.chunkTimes.shift();
        }
        this.stats.avgChunkTime = this.chunkTimes.reduce((a, b) => a + b, 0) / this.chunkTimes.length;
    }

    private adaptChunkSize(): void {
        const target = this.config.targetFrameTime;
        const avg = this.stats.avgChunkTime;

        if (avg === 0) return;

        if (avg < target * 0.5) {
            // We're fast, increase chunk size
            this.stats.currentChunkSize = Math.min(
                this.stats.currentChunkSize * 1.5,
                this.config.maxChunkSize
            );
        } else if (avg > target * 0.9) {
            // We're slow, decrease chunk size
            this.stats.currentChunkSize = Math.max(
                this.stats.currentChunkSize * 0.7,
                this.config.minChunkSize
            );
        }

        this.stats.currentChunkSize = Math.floor(this.stats.currentChunkSize);
    }

    /** Abort current stream */
    abort(): void {
        if (this.controller) {
            this.controller.abort();
            this.controller = null;
        }
        if (this.reader) {
            this.reader.cancel().catch(() => {});
            this.reader = null;
        }
    }

    /** Get current stats */
    getStats(): StreamStats {
        return { ...this.stats };
    }

    /** Stream from base64 string (sync-like via microtasks) */
    async streamFromBase64(base64: string, callback: StreamCallback): Promise<void> {
        this.stats = this.createEmptyStats();
        
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        let pos = 0;
        while (pos < bytes.length) {
            const chunkSize = Math.min(this.stats.currentChunkSize, bytes.length - pos);
            const chunk = bytes.subarray(pos, pos + chunkSize);
            pos += chunkSize;

            const chunkStart = performance.now();
            callback(chunk, pos >= bytes.length);
            const chunkTime = performance.now() - chunkStart;

            this.stats.bytesReceived += chunkSize;
            this.stats.chunksReceived++;
            this.recordChunkTime(chunkTime);

            if (this.config.adaptiveEnabled) {
                this.adaptChunkSize();
            }

            await this.yieldFrame();
        }
    }

    /** Stream from ArrayBuffer */
    async streamFromBuffer(buffer: ArrayBuffer, callback: StreamCallback): Promise<void> {
        const bytes = new Uint8Array(buffer);
        this.stats = this.createEmptyStats();

        let pos = 0;
        while (pos < bytes.length) {
            const chunkSize = Math.min(this.stats.currentChunkSize, bytes.length - pos);
            const chunk = bytes.subarray(pos, pos + chunkSize);
            pos += chunkSize;

            callback(chunk, pos >= bytes.length);
            this.stats.bytesReceived += chunkSize;
            this.stats.chunksReceived++;

            await this.yieldFrame();
        }
    }

    /**
     * Stream a single file with UI-friendly yielding
     * Called by FXDiskClient.streamIntoVFS() for on-demand module loading
     */
    async streamFile(url: string, onChunk: (chunk: Uint8Array) => void): Promise<void> {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
            throw new Error('No response body');
        }

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Yield to UI every chunk to prevent blocking
                await this.yieldFrame();

                // Pass chunk to callback
                onChunk(value);
            }
        } finally {
            reader.releaseLock();
        }
    }
}
