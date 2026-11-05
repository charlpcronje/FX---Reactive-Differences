// fx-disk/fx-disk-vfs.ts
/**
 * FXDisk WASM Smart Client - Virtual File System
 * Manages files, chunks, and deduplication
 */

import { VFSFileEntry, ChunkHash, CHUNK_SIZE, BundleManifest } from './fx-disk-types.js';
import { ChunkManager } from './fx-disk-chunks.js';
import { LZ4Decompressor, lz4CompressFrame } from './fx-disk-lz4.js';
import { logger } from './fx-disk-logger.js';

export class VirtualFileSystem {
    private files = new Map<string, VFSFileEntry>();
    private chunks: ChunkManager;
    private decompressor: LZ4Decompressor;
    private textDecoder = new TextDecoder();
    private textEncoder = new TextEncoder();

    constructor() {
        this.chunks = new ChunkManager();
        this.decompressor = new LZ4Decompressor();
    }

    /** Add a file to the VFS */
    addFile(path: string, content: Uint8Array, compress = true): VFSFileEntry {
        const normalized = this.normalizePath(path);
        
        // Compress if requested
        let data = content;
        let compression: 'lz4' | 'none' = 'none';
        
        if (compress && content.length > 256) {
            data = lz4CompressFrame(content);
            compression = 'lz4';
            logger.debug(`Compressed ${path}: ${content.length} -> ${data.length}`);
        }

        // Split into chunks
        const chunkData = this.chunks.splitIntoChunks(data);
        const chunkHashes: ChunkHash[] = [];

        for (const chunk of chunkData) {
            const hash = this.chunks.addChunk(chunk);
            chunkHashes.push(hash);
        }

        const entry: VFSFileEntry = {
            path: normalized,
            chunks: chunkHashes,
            size: content.length,
            compression,
            contentType: this.detectContentType(path),
        };

        this.files.set(normalized, entry);
        return entry;
    }

    /** Add file from string */
    addFileString(path: string, content: string, compress = true): VFSFileEntry {
        return this.addFile(path, this.textEncoder.encode(content), compress);
    }

    /** Read file as bytes */
    readFile(path: string): Uint8Array {
        const normalized = this.normalizePath(path);
        const entry = this.files.get(normalized);
        
        if (!entry) {
            throw new Error(`File not found: ${path}`);
        }

        // Assemble chunks
        let data = this.chunks.assembleChunks(entry.chunks);

        // Decompress if needed
        if (entry.compression === 'lz4') {
            data = this.decompressor.decompressFrame(data);
        }

        return data;
    }

    /** Read file as string */
    readFileString(path: string): string {
        return this.textDecoder.decode(this.readFile(path));
    }

    /** Check if file exists */
    exists(path: string): boolean {
        return this.files.has(this.normalizePath(path));
    }

    /** List all files */
    listFiles(): string[] {
        return Array.from(this.files.keys());
    }

    /** Get file entry */
    getEntry(path: string): VFSFileEntry | undefined {
        return this.files.get(this.normalizePath(path));
    }

    /** Delete file */
    deleteFile(path: string): boolean {
        const normalized = this.normalizePath(path);
        const entry = this.files.get(normalized);
        
        if (!entry) return false;

        // Decrement chunk refs
        for (const hash of entry.chunks) {
            this.chunks.removeChunk(hash);
        }

        this.files.delete(normalized);
        return true;
    }

    /** Get file count */
    fileCount(): number {
        return this.files.size;
    }

    /** Get chunk count */
    chunkCount(): number {
        return this.chunks.getStats().total;
    }

    /** Get dedup count */
    dedupCount(): number {
        return this.chunks.getStats().dedups;
    }

    /** Export as bundle */
    exportBundle(): Uint8Array {
        // Manifest + chunks
        const manifest: BundleManifest = {
            version: '2.0.0',
            created: new Date().toISOString(),
            files: Array.from(this.files.values()),
            chunkCount: this.chunkCount(),
            totalSize: this.getTotalSize(),
            compressedSize: this.getCompressedSize(),
        };

        const manifestJson = JSON.stringify(manifest);
        const manifestBytes = this.textEncoder.encode(manifestJson);
        const chunkBytes = this.chunks.exportChunks();

        // Format: [manifestLen:u32][manifest][chunks]
        const total = 4 + manifestBytes.length + chunkBytes.length;
        const buffer = new ArrayBuffer(total);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        view.setUint32(0, manifestBytes.length, true);
        bytes.set(manifestBytes, 4);
        bytes.set(chunkBytes, 4 + manifestBytes.length);

        return bytes;
    }

    /** Import from bundle */
    importBundle(data: Uint8Array): number {
        if (data.length < 4) {
            throw new Error('Invalid bundle: too short');
        }

        const view = new DataView(data.buffer, data.byteOffset);
        const manifestLen = view.getUint32(0, true);

        if (data.length < 4 + manifestLen) {
            throw new Error('Invalid bundle: truncated manifest');
        }

        const manifestBytes = data.subarray(4, 4 + manifestLen);
        const manifest: BundleManifest = JSON.parse(this.textDecoder.decode(manifestBytes));

        // Import chunks
        const chunkData = data.subarray(4 + manifestLen);
        this.chunks.importChunks(chunkData);

        // Register files
        for (const entry of manifest.files) {
            this.files.set(entry.path, entry);
        }

        logger.info(`Imported bundle v${manifest.version}`, {
            files: manifest.files.length,
            chunks: manifest.chunkCount,
        });

        return manifest.files.length;
    }

    /** Get total original size */
    getTotalSize(): number {
        let total = 0;
        for (const entry of this.files.values()) {
            total += entry.size;
        }
        return total;
    }

    /** Get compressed size */
    getCompressedSize(): number {
        return this.chunks.getStats().bytes;
    }

    /** Get compression ratio */
    getCompressionRatio(): number {
        const original = this.getTotalSize();
        const compressed = this.getCompressedSize();
        return original > 0 ? compressed / original : 1;
    }

    /** Normalize path */
    private normalizePath(path: string): string {
        let normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
        const parts = normalized.split('/').filter(p => p && p !== '.');
        const result: string[] = [];
        
        for (const part of parts) {
            if (part === '..') result.pop();
            else result.push(part);
        }
        
        return result.join('/');
    }

    /** Detect content type */
    private detectContentType(path: string): string {
        const ext = path.split('.').pop()?.toLowerCase();
        const types: Record<string, string> = {
            ts: 'application/typescript',
            tsx: 'application/typescript',
            js: 'application/javascript',
            jsx: 'application/javascript',
            mjs: 'application/javascript',
            json: 'application/json',
            html: 'text/html',
            css: 'text/css',
            md: 'text/markdown',
            fxc: 'application/fx-component',
            wasm: 'application/wasm',
        };
        return types[ext || ''] || 'application/octet-stream';
    }

    /** Clear all files and chunks */
    clear(): void {
        this.files.clear();
        this.chunks.clear();
    }

    /** Get statistics */
    getStats(): {
        files: number;
        chunks: number;
        dedups: number;
        totalSize: number;
        compressedSize: number;
        ratio: number;
    } {
        const chunkStats = this.chunks.getStats();
        return {
            files: this.files.size,
            chunks: chunkStats.total,
            dedups: chunkStats.dedups,
            totalSize: this.getTotalSize(),
            compressedSize: chunkStats.bytes,
            ratio: this.getCompressionRatio(),
        };
    }
}
