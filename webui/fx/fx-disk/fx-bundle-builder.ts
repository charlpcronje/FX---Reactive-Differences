// fx-disk/fx-bundle-builder.ts
/**
 * FX Bundle Builder - Create VFS bundles with plugins
 *
 * This tool helps you create optimized bundles containing:
 * - Core FX framework files
 * - Plugin modules
 * - Application code
 * - Dependencies
 *
 * Usage:
 *   const builder = new BundleBuilder();
 *   builder.addPlugin('./plugins/fx-dom-dollar.ts');
 *   builder.addPlugin('./plugins/fx-orm.ts');
 *   const bundle = await builder.build();
 *   await builder.writeBundle('./dist/fx-bundle.bin', bundle);
 */

import { VirtualFileSystem } from './fx-disk-vfs.js';
import { logger } from './fx-disk-logger.js';

export interface BundleConfig {
    /** Base directory for resolving paths */
    baseDir?: string;

    /** Enable compression (LZ4) */
    compress?: boolean;

    /** Include source maps */
    sourceMaps?: boolean;

    /** Minify code */
    minify?: boolean;

    /** Output format */
    format?: 'binary' | 'base64' | 'json';

    /** Bundle metadata */
    metadata?: {
        name?: string;
        version?: string;
        author?: string;
        description?: string;
    };
}

export interface FileEntry {
    /** Virtual path in bundle */
    path: string;

    /** Source file path or content */
    source: string | Uint8Array;

    /** File type */
    type?: 'plugin' | 'module' | 'asset' | 'config';

    /** Compression enabled for this file */
    compress?: boolean;
}

/**
 * Bundle Builder
 */
export class BundleBuilder {
    private vfs: VirtualFileSystem;
    private config: BundleConfig;
    private files: FileEntry[] = [];
    private manifest: any = {
        files: {},
        plugins: {},
        modules: {},
        assets: {}
    };

    constructor(config: BundleConfig = {}) {
        this.vfs = new VirtualFileSystem();
        this.config = {
            compress: true,
            sourceMaps: false,
            minify: false,
            format: 'binary',
            ...config
        };
    }

    /**
     * Add a plugin to the bundle
     */
    addPlugin(pathOrContent: string | { path: string; content: string }, virtualPath?: string): this {
        let content: string;
        let sourcePath: string;
        let vPath: string;

        if (typeof pathOrContent === 'string') {
            sourcePath = pathOrContent;
            content = this.readFile(sourcePath);
            vPath = virtualPath || this.normalizePluginPath(sourcePath);
        } else {
            sourcePath = pathOrContent.path;
            content = pathOrContent.content;
            vPath = virtualPath || this.normalizePluginPath(sourcePath);
        }

        this.files.push({
            path: vPath,
            source: content,
            type: 'plugin',
            compress: this.config.compress
        });

        // Add to manifest
        this.manifest.plugins[vPath] = {
            sourcePath,
            type: 'plugin'
        };

        logger.info(`Added plugin: ${vPath}`);
        return this;
    }

    /**
     * Add a module to the bundle
     */
    addModule(pathOrContent: string | { path: string; content: string }, virtualPath?: string): this {
        let content: string;
        let sourcePath: string;
        let vPath: string;

        if (typeof pathOrContent === 'string') {
            sourcePath = pathOrContent;
            content = this.readFile(sourcePath);
            vPath = virtualPath || this.normalizeModulePath(sourcePath);
        } else {
            sourcePath = pathOrContent.path;
            content = pathOrContent.content;
            vPath = virtualPath || this.normalizeModulePath(sourcePath);
        }

        this.files.push({
            path: vPath,
            source: content,
            type: 'module',
            compress: this.config.compress
        });

        // Add to manifest
        this.manifest.modules[vPath] = {
            sourcePath,
            type: 'module'
        };

        logger.info(`Added module: ${vPath}`);
        return this;
    }

    /**
     * Add an asset file
     */
    addAsset(pathOrContent: string | { path: string; content: string | Uint8Array }, virtualPath?: string): this {
        let content: string | Uint8Array;
        let sourcePath: string;
        let vPath: string;

        if (typeof pathOrContent === 'string') {
            sourcePath = pathOrContent;
            content = this.readFile(sourcePath);
            vPath = virtualPath || this.normalizeAssetPath(sourcePath);
        } else {
            sourcePath = pathOrContent.path;
            content = pathOrContent.content;
            vPath = virtualPath || this.normalizeAssetPath(sourcePath);
        }

        this.files.push({
            path: vPath,
            source: content,
            type: 'asset',
            compress: this.config.compress && typeof content === 'string'
        });

        // Add to manifest
        this.manifest.assets[vPath] = {
            sourcePath,
            type: 'asset'
        };

        logger.info(`Added asset: ${vPath}`);
        return this;
    }

    /**
     * Add all plugins from a directory
     */
    async addPluginsFromDir(dir: string, pattern: RegExp = /\.(ts|js)$/): Promise<this> {
        const files = await this.listDirectory(dir);

        for (const file of files) {
            if (pattern.test(file)) {
                const fullPath = this.joinPath(dir, file);
                this.addPlugin(fullPath);
            }
        }

        return this;
    }

    /**
     * Add a manifest configuration
     */
    addManifest(config: any): this {
        this.addFile('.fxrc.json', JSON.stringify(config, null, 2), 'config');
        return this;
    }

    /**
     * Add a raw file
     */
    addFile(virtualPath: string, content: string | Uint8Array, type?: string): this {
        this.files.push({
            path: virtualPath,
            source: content,
            type: type as any || 'module',
            compress: this.config.compress && typeof content === 'string'
        });

        this.manifest.files[virtualPath] = {
            type: type || 'file'
        };

        logger.info(`Added file: ${virtualPath}`);
        return this;
    }

    /**
     * Build the bundle
     */
    async build(): Promise<Uint8Array> {
        logger.info('Building bundle...');

        // Add all files to VFS
        for (const file of this.files) {
            const content = typeof file.source === 'string'
                ? new TextEncoder().encode(file.source)
                : file.source;

            this.vfs.addFile(file.path, content, file.compress);
        }

        // Add manifest
        const manifestContent = JSON.stringify(this.manifest, null, 2);
        this.vfs.addFileString('__bundle_manifest__.json', manifestContent, false);

        // Export bundle
        const bundle = this.vfs.exportBundle();

        const stats = this.vfs.getStats();
        logger.info(`Bundle built:`, {
            files: stats.files,
            chunks: stats.chunks,
            dedups: stats.dedups,
            totalSize: `${(stats.totalSize / 1024).toFixed(2)} KB`,
            compressedSize: `${(stats.compressedSize / 1024).toFixed(2)} KB`,
            ratio: `${(stats.ratio * 100).toFixed(1)}%`
        });

        return bundle;
    }

    /**
     * Build and get as base64
     */
    async buildBase64(): Promise<string> {
        const bundle = await this.build();
        return this.toBase64(bundle);
    }

    /**
     * Build and write to file
     */
    async writeBundle(outputPath: string, bundle?: Uint8Array): Promise<void> {
        const data = bundle || await this.build();

        if (this.config.format === 'base64') {
            const base64 = this.toBase64(data);
            await this.writeFile(outputPath, base64);
        } else {
            await this.writeFile(outputPath, data);
        }

        logger.info(`Bundle written to: ${outputPath}`);
    }

    /**
     * Get bundle statistics
     */
    getStats() {
        return {
            filesCount: this.files.length,
            ...this.vfs.getStats()
        };
    }

    // ===== Helper Methods =====

    private normalizePluginPath(path: string): string {
        const fileName = path.split('/').pop()!;
        return `plugins/${fileName}`;
    }

    private normalizeModulePath(path: string): string {
        const fileName = path.split('/').pop()!;
        return `modules/${fileName}`;
    }

    private normalizeAssetPath(path: string): string {
        const fileName = path.split('/').pop()!;
        return `assets/${fileName}`;
    }

    private toBase64(data: Uint8Array): string {
        let binary = '';
        const len = data.length;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(data[i]);
        }
        return btoa(binary);
    }

    // Platform-specific file operations
    private readFile(path: string): string {
        if (typeof process !== 'undefined' && (process as any).versions?.node) {
            // Node.js
            const fs = require('fs');
            const resolved = require('path').resolve(this.config.baseDir || process.cwd(), path);
            return fs.readFileSync(resolved, 'utf-8');
        } else if (typeof (globalThis as any).Deno !== 'undefined') {
            // Deno
            const resolved = this.config.baseDir
                ? `${this.config.baseDir}/${path}`
                : path;
            return (globalThis as any).Deno.readTextFileSync(resolved);
        } else {
            throw new Error('File reading not supported in this environment');
        }
    }

    private async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (typeof process !== 'undefined' && (process as any).versions?.node) {
            // Node.js
            const fs = require('fs');
            const pathModule = require('path');
            const resolved = pathModule.resolve(this.config.baseDir || process.cwd(), path);

            // Ensure directory exists
            const dir = pathModule.dirname(resolved);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            fs.writeFileSync(resolved, content);
        } else if (typeof (globalThis as any).Deno !== 'undefined') {
            // Deno
            const resolved = this.config.baseDir
                ? `${this.config.baseDir}/${path}`
                : path;

            await (globalThis as any).Deno.writeFile(resolved, content);
        } else {
            throw new Error('File writing not supported in this environment');
        }
    }

    private async listDirectory(dir: string): Promise<string[]> {
        if (typeof process !== 'undefined' && (process as any).versions?.node) {
            // Node.js
            const fs = require('fs');
            const path = require('path');
            const resolved = path.resolve(this.config.baseDir || process.cwd(), dir);
            return fs.readdirSync(resolved);
        } else if (typeof (globalThis as any).Deno !== 'undefined') {
            // Deno
            const resolved = this.config.baseDir
                ? `${this.config.baseDir}/${dir}`
                : dir;
            const entries = [];
            for await (const entry of (globalThis as any).Deno.readDir(resolved)) {
                entries.push(entry.name);
            }
            return entries;
        } else {
            throw new Error('Directory listing not supported in this environment');
        }
    }

    private joinPath(...parts: string[]): string {
        return parts.join('/').replace(/\/+/g, '/');
    }
}

/**
 * Convenience function to create a bundle
 */
export async function createBundle(config: BundleConfig, setup: (builder: BundleBuilder) => void | Promise<void>): Promise<Uint8Array> {
    const builder = new BundleBuilder(config);
    await setup(builder);
    return builder.build();
}

/**
 * Export default
 */
export default {
    BundleBuilder,
    createBundle
};
