// fx-disk/fx-load.ts
/**
 * FXDisk Minimal Loader - Ultra-fast synchronous module loading
 * 
 * This is the minimal sync loader that:
 * 1. Reads from WASM VFS (instant, <1ms)
 * 2. Falls back to sync XHR (works but slower)
 * 
 * Usage:
 *   import { load, read } from './fx-disk/fx-load.js';
 *   const fx = load('fx.ts');
 *   const code = read('plugin.ts');
 */

import { getFXDiskClient, FXDiskClient } from './fx-disk-client.js';
import { DiskState } from './fx-disk-types.js';
import { logger } from './fx-disk-logger.js';

/** Global client reference */
let client: FXDiskClient | null = null;

/** Module cache for sync access */
const moduleCache = new Map<string, unknown>();
const fileCache = new Map<string, string>();

/** Initialize the loader */
export function init(): FXDiskClient {
    if (!client) {
        client = getFXDiskClient();
    }
    return client;
}

/** Normalize path */
function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/** Sync XHR fallback */
function fetchSyncXHR(url: string): string {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url, false); // SYNCHRONOUS - blocks UI but fast for local
    xhr.send();
    
    if (xhr.status === 200) {
        return xhr.responseText;
    }
    
    throw new Error(`[FX-Load] HTTP ${xhr.status} for ${url}`);
}

/** Read file as string - SYNCHRONOUS */
export function read(path: string): string {
    const normalized = normalizePath(path);
    
    // Check file cache
    if (fileCache.has(normalized)) {
        return fileCache.get(normalized)!;
    }

    // Try VFS first
    if (client && client.getState() !== DiskState.UNMOUNTED) {
        try {
            if (client.exists(normalized)) {
                const content = client.readFileSync(normalized);
                fileCache.set(normalized, content);
                return content;
            }
        } catch (e) {
            logger.debug(`VFS read failed: ${normalized}`, e);
        }
    }

    // Fallback to sync XHR
    logger.debug(`XHR fallback: ${path}`);
    const content = fetchSyncXHR(path);
    fileCache.set(normalized, content);
    return content;
}

/** Execute module code */
function executeModule(code: string, path: string): unknown {
    // Transform export syntax for CommonJS-style execution
    const transformed = code
        .replace(/export\s+default\s+/g, 'module.exports.default = ')
        .replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ')
        .replace(/\bexport\s+\{[^}]+\}/g, '');

    const module: { exports: Record<string, unknown> } = { exports: {} };
    const exports = module.exports;

    const require = (depPath: string): unknown => {
        // Resolve relative paths
        if (depPath.startsWith('./') || depPath.startsWith('../')) {
            const base = path.substring(0, path.lastIndexOf('/'));
            const parts = `${base}/${depPath}`.split('/');
            const result: string[] = [];
            
            for (const part of parts) {
                if (part === '' || part === '.') continue;
                if (part === '..') result.pop();
                else result.push(part);
            }
            
            depPath = result.join('/');
        }
        
        return load(depPath);
    };

    try {
        const fn = new Function('module', 'exports', 'require', transformed);
        fn.call(exports, module, exports, require);
        return module.exports.default ?? module.exports;
    } catch (err) {
        logger.error(`Module execution failed: ${path}`, err);
        throw err;
    }
}

/** Load and execute module - SYNCHRONOUS */
export function load(path: string): unknown {
    const normalized = normalizePath(path);
    
    // Check module cache
    if (moduleCache.has(normalized)) {
        return moduleCache.get(normalized);
    }

    // Read file
    const code = read(path);
    
    // Execute
    const result = executeModule(code, normalized);
    
    // Cache
    moduleCache.set(normalized, result);
    
    return result;
}

/** Check if file exists */
export function exists(path: string): boolean {
    const normalized = normalizePath(path);
    
    if (fileCache.has(normalized)) return true;
    
    if (client && client.getState() !== DiskState.UNMOUNTED) {
        return client.exists(normalized);
    }
    
    // Try XHR HEAD request
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('HEAD', path, false);
        xhr.send();
        return xhr.status === 200;
    } catch {
        return false;
    }
}

/** List files in VFS */
export function list(): string[] {
    if (client && client.getState() !== DiskState.UNMOUNTED) {
        return client.listFiles();
    }
    return [];
}

/** Clear all caches */
export function clear(): void {
    moduleCache.clear();
    fileCache.clear();
}

/** Get loader stats */
export function stats(): {
    vfsReady: boolean;
    cachedModules: number;
    cachedFiles: number;
    vfsFiles: number;
} {
    return {
        vfsReady: client ? client.getState() !== DiskState.UNMOUNTED : false,
        cachedModules: moduleCache.size,
        cachedFiles: fileCache.size,
        vfsFiles: client ? client.listFiles().length : 0,
    };
}

/** Load bundle and initialize VFS */
export async function loadBundle(url: string): Promise<number> {
    init();
    return client!.loadBundle(url);
}

/** Load bundle from base64 */
export async function loadBundleBase64(base64: string): Promise<number> {
    init();
    return client!.loadBundleBase64(base64);
}

/** Load bundle synchronously */
export function loadBundleSync(data: Uint8Array): number {
    init();
    return client!.loadBundleSync(data);
}

/** Create an FX-compatible loader interface */
export function createFXLoader() {
    return {
        loadSync: load,
        readSync: read,
        loadAsync: async (path: string) => load(path),
        exists,
        list,
        clear,
        stats,
        loadBundle,
        loadBundleBase64,
        loadBundleSync,
    };
}

// Export default object
export default {
    init,
    load,
    read,
    exists,
    list,
    clear,
    stats,
    loadBundle,
    loadBundleBase64,
    loadBundleSync,
    createFXLoader,
};
