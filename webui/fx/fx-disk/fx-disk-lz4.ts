// fx-disk/fx-disk-lz4.ts
/**
 * FXDisk WASM Smart Client - LZ4 Streaming Decompressor
 * Pure TypeScript LZ4 block format decompression
 */

import { logger } from './fx-disk-logger.js';

/** LZ4 magic number */
const LZ4_MAGIC = 0x184D2204;

/** LZ4 block decompressor */
export class LZ4Decompressor {
    private buffer: Uint8Array = new Uint8Array(0);
    private position = 0;
    private outputBuffer: Uint8Array[] = [];

    /** Decompress LZ4 block data */
    decompress(input: Uint8Array): Uint8Array {
        const output: number[] = [];
        let pos = 0;

        while (pos < input.length) {
            const token = input[pos++];
            
            // Literal length
            let literalLen = (token >> 4) & 0x0F;
            if (literalLen === 15) {
                let b: number;
                do {
                    b = input[pos++];
                    literalLen += b;
                } while (b === 255);
            }

            // Copy literals
            for (let i = 0; i < literalLen; i++) {
                output.push(input[pos++]);
            }

            // Check if we've reached the end
            if (pos >= input.length) break;

            // Match offset (little endian)
            const offset = input[pos] | (input[pos + 1] << 8);
            pos += 2;

            // Match length
            let matchLen = token & 0x0F;
            if (matchLen === 15) {
                let b: number;
                do {
                    b = input[pos++];
                    matchLen += b;
                } while (b === 255);
            }
            matchLen += 4; // Min match is 4

            // Copy match
            const matchPos = output.length - offset;
            for (let i = 0; i < matchLen; i++) {
                output.push(output[matchPos + i]);
            }
        }

        return new Uint8Array(output);
    }

    /** Decompress LZ4 frame format */
    decompressFrame(input: Uint8Array): Uint8Array {
        const view = new DataView(input.buffer, input.byteOffset);
        let pos = 0;

        // Check magic
        const magic = view.getUint32(pos, true);
        if (magic !== LZ4_MAGIC) {
            logger.warn('Not LZ4 frame format, trying raw block');
            return this.decompress(input);
        }
        pos += 4;

        // Frame descriptor
        const flg = input[pos++];
        const bd = input[pos++];
        
        const version = (flg >> 6) & 0x03;
        const blockIndep = (flg >> 5) & 0x01;
        const blockChecksum = (flg >> 4) & 0x01;
        const contentSize = (flg >> 3) & 0x01;
        const contentChecksum = (flg >> 2) & 0x01;
        const dictId = flg & 0x01;

        const blockMaxSize = (bd >> 4) & 0x07;

        // Skip content size if present
        if (contentSize) pos += 8;
        // Skip dict id if present
        if (dictId) pos += 4;
        // Skip header checksum
        pos += 1;

        // Read blocks
        const output: number[] = [];

        while (pos < input.length) {
            const blockSize = view.getUint32(pos, true);
            pos += 4;

            if (blockSize === 0) break; // End marker

            const isCompressed = (blockSize & 0x80000000) === 0;
            const size = blockSize & 0x7FFFFFFF;

            if (pos + size > input.length) break;

            const blockData = input.subarray(pos, pos + size);
            pos += size;

            if (blockChecksum) pos += 4; // Skip block checksum

            if (isCompressed) {
                const decompressed = this.decompress(blockData);
                for (const b of decompressed) output.push(b);
            } else {
                for (const b of blockData) output.push(b);
            }
        }

        return new Uint8Array(output);
    }

    /** Stream decompress - feed chunks, get output */
    streamDecompress(chunk: Uint8Array): Uint8Array | null {
        // Append to buffer
        const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
        newBuffer.set(this.buffer);
        newBuffer.set(chunk, this.buffer.length);
        this.buffer = newBuffer;

        // Try to decompress complete blocks
        if (this.buffer.length < 4) return null;

        const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
        
        // Check for magic
        if (this.position === 0) {
            const magic = view.getUint32(0, true);
            if (magic === LZ4_MAGIC) {
                // Skip frame header (simplified)
                this.position = 7;
            }
        }

        // Try to read a block
        if (this.position + 4 > this.buffer.length) return null;

        const blockSize = view.getUint32(this.position, true);
        if (blockSize === 0) {
            // End marker
            this.reset();
            return new Uint8Array(0);
        }

        const size = blockSize & 0x7FFFFFFF;
        const isCompressed = (blockSize & 0x80000000) === 0;

        if (this.position + 4 + size > this.buffer.length) {
            return null; // Need more data
        }

        const blockData = this.buffer.subarray(this.position + 4, this.position + 4 + size);
        this.position += 4 + size;

        // Trim buffer
        this.buffer = this.buffer.subarray(this.position);
        this.position = 0;

        if (isCompressed) {
            return this.decompress(blockData);
        }
        return new Uint8Array(blockData);
    }

    /** Reset streaming state */
    reset(): void {
        this.buffer = new Uint8Array(0);
        this.position = 0;
        this.outputBuffer = [];
    }
}

/** Compress data using LZ4 block format */
export function lz4Compress(input: Uint8Array): Uint8Array {
    // Simple LZ4 compression - just store literals for now (valid but not optimal)
    const output: number[] = [];
    let pos = 0;

    while (pos < input.length) {
        const remaining = input.length - pos;
        const chunkSize = Math.min(remaining, 65535);
        
        // Token: literal length in high nibble (15 means more follows)
        if (chunkSize >= 15) {
            output.push(0xF0); // 15 << 4
            let extra = chunkSize - 15;
            while (extra >= 255) {
                output.push(255);
                extra -= 255;
            }
            output.push(extra);
        } else {
            output.push(chunkSize << 4);
        }

        // Literals
        for (let i = 0; i < chunkSize; i++) {
            output.push(input[pos++]);
        }
    }

    return new Uint8Array(output);
}

/** Wrap in LZ4 frame format */
export function lz4CompressFrame(input: Uint8Array): Uint8Array {
    const blocks = lz4Compress(input);
    
    // Build frame
    const output: number[] = [];
    
    // Magic
    output.push(LZ4_MAGIC & 0xFF);
    output.push((LZ4_MAGIC >> 8) & 0xFF);
    output.push((LZ4_MAGIC >> 16) & 0xFF);
    output.push((LZ4_MAGIC >> 24) & 0xFF);
    
    // Frame descriptor
    output.push(0x60); // FLG: version 01, block independent
    output.push(0x70); // BD: 4MB max block
    output.push(0x00); // HC placeholder
    
    // Block size (compressed)
    output.push(blocks.length & 0xFF);
    output.push((blocks.length >> 8) & 0xFF);
    output.push((blocks.length >> 16) & 0xFF);
    output.push((blocks.length >> 24) & 0xFF);
    
    // Block data
    for (const b of blocks) output.push(b);
    
    // End marker
    output.push(0, 0, 0, 0);
    
    return new Uint8Array(output);
}
