// fx-disk/fx-disk-chunks.ts
/**
 * FXDisk WASM Smart Client - Chunk Manager
 * Handles 4KB block deduplication and hash management
 */

import { CHUNK_SIZE, ChunkHash, ChunkEntry } from './fx-disk-types.js';
import { logger } from './fx-disk-logger.js';

export class ChunkManager {
    private chunks = new Map<ChunkHash, ChunkEntry>();
    private pendingHashes = new Set<ChunkHash>();
    private dedupCount = 0;

    /** Compute SHA-256 hash of data, truncated to 32 hex chars */
    async computeHash(data: Uint8Array): Promise<ChunkHash> {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = new Uint8Array(hashBuffer);
        let hex = '';
        for (let i = 0; i < 16; i++) { // Use first 16 bytes = 32 hex chars
            hex += hashArray[i].toString(16).padStart(2, '0');
        }
        return hex;
    }

    /** Compute hash synchronously using simple hash (faster for small chunks) */
    computeHashSync(data: Uint8Array): ChunkHash {
        // FNV-1a 64-bit hash, output as 16 hex chars
        let h1 = 0x811c9dc5n;
        let h2 = 0x811c9dc5n;
        const len = data.length;
        for (let i = 0; i < len; i++) {
            const b = BigInt(data[i]);
            h1 ^= b;
            h1 = (h1 * 0x01000193n) & 0xffffffffn;
            h2 ^= b;
            h2 = (h2 * 0x01000193n) & 0xffffffffn;
            h2 = ((h2 << 5n) | (h2 >> 27n)) & 0xffffffffn;
        }
        return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    }

    /** Split data into 4KB chunks */
    splitIntoChunks(data: Uint8Array): Uint8Array[] {
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
            chunks.push(data.subarray(i, Math.min(i + CHUNK_SIZE, data.length)));
        }
        return chunks;
    }

    /** Add chunk with deduplication, returns hash */
    addChunk(data: Uint8Array): ChunkHash {
        const hash = this.computeHashSync(data);
        const existing = this.chunks.get(hash);
        
        if (existing) {
            existing.refCount++;
            this.dedupCount++;
            logger.debug(`Dedup chunk: ${hash.substring(0, 8)}...`);
            return hash;
        }

        this.chunks.set(hash, {
            hash,
            data: new Uint8Array(data), // Copy to avoid reference issues
            refCount: 1,
        });
        
        return hash;
    }

    /** Get chunk by hash */
    getChunk(hash: ChunkHash): Uint8Array | null {
        const entry = this.chunks.get(hash);
        return entry?.data ?? null;
    }

    /** Check if chunk exists */
    hasChunk(hash: ChunkHash): boolean {
        return this.chunks.has(hash);
    }

    /** Mark chunk as pending (for streaming) */
    markPending(hash: ChunkHash): void {
        this.pendingHashes.add(hash);
    }

    /** Check if chunk is pending */
    isPending(hash: ChunkHash): boolean {
        return this.pendingHashes.has(hash);
    }

    /** Complete pending chunk */
    completePending(hash: ChunkHash): void {
        this.pendingHashes.delete(hash);
    }

    /** Reassemble chunks into full data */
    assembleChunks(hashes: ChunkHash[]): Uint8Array {
        let totalSize = 0;
        const parts: Uint8Array[] = [];

        for (const hash of hashes) {
            const chunk = this.getChunk(hash);
            if (!chunk) {
                throw new Error(`Missing chunk: ${hash}`);
            }
            parts.push(chunk);
            totalSize += chunk.length;
        }

        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
        }

        return result;
    }

    /** Remove chunk (decrement ref count) */
    removeChunk(hash: ChunkHash): boolean {
        const entry = this.chunks.get(hash);
        if (!entry) return false;

        entry.refCount--;
        if (entry.refCount <= 0) {
            this.chunks.delete(hash);
            return true;
        }
        return false;
    }

    /** Get statistics */
    getStats(): { total: number; dedups: number; bytes: number } {
        let bytes = 0;
        for (const entry of this.chunks.values()) {
            bytes += entry.data.length;
        }
        return {
            total: this.chunks.size,
            dedups: this.dedupCount,
            bytes,
        };
    }

    /** Export all chunks as binary */
    exportChunks(): Uint8Array {
        // Format: [count:u32][entries...]
        // Entry: [hash:16 bytes][len:u32][data:bytes]
        let totalSize = 4;
        for (const entry of this.chunks.values()) {
            totalSize += 16 + 4 + entry.data.length;
        }

        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);
        let offset = 0;

        view.setUint32(offset, this.chunks.size, true);
        offset += 4;

        for (const entry of this.chunks.values()) {
            // Hash as 16 bytes
            for (let i = 0; i < 16; i++) {
                bytes[offset + i] = parseInt(entry.hash.substring(i * 2, i * 2 + 2), 16);
            }
            offset += 16;

            view.setUint32(offset, entry.data.length, true);
            offset += 4;

            bytes.set(entry.data, offset);
            offset += entry.data.length;
        }

        return bytes;
    }

    /** Import chunks from binary */
    importChunks(data: Uint8Array): number {
        if (data.length < 4) return 0;

        const view = new DataView(data.buffer, data.byteOffset);
        let offset = 0;

        const count = view.getUint32(offset, true);
        offset += 4;

        for (let i = 0; i < count; i++) {
            // Read hash
            let hash = '';
            for (let j = 0; j < 16; j++) {
                hash += data[offset + j].toString(16).padStart(2, '0');
            }
            offset += 16;

            const len = view.getUint32(offset, true);
            offset += 4;

            const chunkData = data.subarray(offset, offset + len);
            offset += len;

            if (!this.hasChunk(hash)) {
                this.chunks.set(hash, {
                    hash,
                    data: new Uint8Array(chunkData),
                    refCount: 1,
                });
            } else {
                const entry = this.chunks.get(hash)!;
                entry.refCount++;
                this.dedupCount++;
            }
        }

        return count;
    }

    /** Clear all chunks */
    clear(): void {
        this.chunks.clear();
        this.pendingHashes.clear();
        this.dedupCount = 0;
    }
}
