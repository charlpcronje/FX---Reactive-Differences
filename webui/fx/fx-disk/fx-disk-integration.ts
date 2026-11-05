// fx-disk/fx-disk-integration.ts
/**
 * FXDisk Integration - Drop-in replacement for SyncModuleLoader
 * Seamlessly integrates FXDisk with FX Framework
 */

import { FXDiskClient, getFXDiskClient, FXDiskClientConfig } from './fx-disk-client.js';
import { DiskState, FXNodeUpdate } from './fx-disk-types.js';
import { logger } from './fx-disk-logger.js';
import * as fxLoad from './fx-load.js';

/** FX Core interface (minimal) */
interface FXCore {
    moduleLoader?: unknown;
    root?: { __nodes: Record<string, unknown> };
}

/** FX Proxy interface */
interface FXProxy {
    (path: string): FXNodeProxy;
}

interface FXNodeProxy {
    set(value: unknown): void;
    get(): unknown;
    merge(value: unknown): void;
    delete(): void;
}

/**
 * WASM-backed SyncModuleLoader replacement
 * Compatible with FX Framework's module loading interface
 */
export class FXDiskModuleLoader {
    private client: FXDiskClient;
    private cache = new Map<string, string>();
    private moduleIntegrity = new Map<string, string>();
    public cspMode = false;

    constructor(config?: FXDiskClientConfig) {
        this.client = getFXDiskClient(config);
    }

    /** Get the underlying client */
    getClient(): FXDiskClient {
        return this.client;
    }

    /** Synchronous module load - FX compatible */
    loadSync(url: string): string {
        const normalized = this.normalizePath(url);
        
        if (this.cache.has(normalized)) {
            return this.cache.get(normalized)!;
        }

        try {
            const content = fxLoad.read(url);
            this.cache.set(normalized, content);
            return content;
        } catch (err) {
            logger.error(`Load failed: ${url}`, err);
            throw err;
        }
    }

    /** Async module load */
    async loadAsync(url: string, timeoutMs = 15000): Promise<string> {
        // For VFS, async is same as sync
        return this.loadSync(url);
    }

    /** Check if file exists */
    exists(url: string): boolean {
        return fxLoad.exists(url);
    }

    /** List all files in VFS */
    listFiles(): string[] {
        return fxLoad.list();
    }

    /** Add file to VFS */
    addFile(path: string, content: string): void {
        this.client.addFile(path, content);
        this.cache.delete(this.normalizePath(path));
    }

    /** Set integrity hash (SyncModuleLoader compatibility) */
    setIntegrity(url: string, hash: string): void {
        this.moduleIntegrity.set(url, hash);
    }

    /** Get integrity hash */
    getIntegrity(url: string): string | undefined {
        return this.moduleIntegrity.get(url);
    }

    /** Clear cache */
    clearCache(): void {
        this.cache.clear();
        fxLoad.clear();
    }

    /** Get stats */
    getStats() {
        return {
            ...fxLoad.stats(),
            ...this.client.getStats(),
        };
    }

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    }

    /** Destroy loader */
    destroy(): void {
        this.cache.clear();
        this.moduleIntegrity.clear();
    }
}

/**
 * Patch FXCore to use FXDisk loader
 */
export function patchFXWithDisk(fx: FXCore, config?: FXDiskClientConfig): FXDiskModuleLoader {
    const loader = new FXDiskModuleLoader(config);
    
    // Replace module loader
    (fx as { moduleLoader: unknown }).moduleLoader = loader;
    
    logger.info('Patched FX with FXDisk loader');
    
    return loader;
}

/**
 * Create FX integration with hot shard support
 */
export function createFXDiskIntegration(
    fx: FXCore,
    $$: FXProxy,
    config?: FXDiskClientConfig
): {
    loader: FXDiskModuleLoader;
    client: FXDiskClient;
    unsubscribe: () => void;
} {
    const loader = patchFXWithDisk(fx, config);
    const client = loader.getClient();

    // Subscribe to hot shard node updates
    const unsubscribe = client.onNodeUpdate((update: FXNodeUpdate) => {
        try {
            const node = $$(update.path);
            
            switch (update.operation) {
                case 'set':
                    node.set(update.value);
                    break;
                case 'merge':
                    node.merge(update.value);
                    break;
                case 'delete':
                    node.delete();
                    break;
            }
            
            logger.debug(`Hot shard update: ${update.operation} ${update.path}`);
        } catch (err) {
            logger.error(`Failed to apply hot shard update: ${update.path}`, err);
        }
    });

    return { loader, client, unsubscribe };
}

/**
 * Load FX Framework from VFS
 */
export function loadFXFromDisk(fxPath = 'fx.ts'): unknown {
    return fxLoad.load(fxPath);
}

/**
 * Initialize FXDisk with bundle
 */
export async function initFXDisk(bundleUrl: string): Promise<{
    client: FXDiskClient;
    load: typeof fxLoad.load;
    read: typeof fxLoad.read;
}> {
    await fxLoad.loadBundle(bundleUrl);
    
    return {
        client: getFXDiskClient(),
        load: fxLoad.load,
        read: fxLoad.read,
    };
}

/**
 * Initialize FXDisk with embedded base64 bundle
 */
export async function initFXDiskBase64(base64: string): Promise<{
    client: FXDiskClient;
    load: typeof fxLoad.load;
    read: typeof fxLoad.read;
}> {
    await fxLoad.loadBundleBase64(base64);
    
    return {
        client: getFXDiskClient(),
        load: fxLoad.load,
        read: fxLoad.read,
    };
}

// Export everything
export { fxLoad };
