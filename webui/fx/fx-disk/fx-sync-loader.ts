// fx-disk/fx-sync-loader.ts
/**
 * FXDisk-Aware SyncModuleLoader
 * 
 * Drop-in replacement for fx.ts SyncModuleLoader that uses FXDisk VFS first,
 * then falls back to Worker+SAB or sync XHR.
 * 
 * Usage in fx.ts:
 *   import { FXDiskSyncLoader } from './fx-disk/fx-sync-loader.js';
 *   // Replace: this.moduleLoader = new SyncModuleLoader();
 *   // With:    this.moduleLoader = new FXDiskSyncLoader();
 * 
 * Then the existing syntax works:
 *   $$("@./path/to/plugin.ts").options({ global: "$plugin" });
 */

import { getFXDiskClient, FXDiskClient } from './fx-disk-client.js';
import { logger } from './fx-disk-logger.js';

// Environment detection (copied from fx.ts for standalone use)
const HAS_DENO = typeof (globalThis as any).Deno !== 'undefined';
const HAS_NODE = typeof process !== 'undefined' && (process as any).versions?.node;
const IS_SERVER = HAS_DENO || HAS_NODE;

/** Loader configuration */
export interface FXDiskSyncLoaderConfig {
    /** Bundle URL to load synchronously at init */
    bundleUrl?: string;
    /** Base64 embedded bundle */
    bundleBase64?: string;
    /** Timeout for network operations */
    timeoutMs?: number;
    /** Enable Worker+SAB fallback */
    enableWorker?: boolean;
}

/** Check if running on UI thread */
function isUIThread(): boolean {
    if (typeof window === 'undefined') return false;
    if (typeof document === 'undefined') return false;
    return true;
}

/** UI-friendly wait using requestAnimationFrame */
async function uiFriendlyWait(
    lock: Int32Array,
    index: number,
    expected: number,
    timeoutMs: number
): Promise<'ok' | 'timed-out'> {
    const start = performance.now();
    return new Promise(resolve => {
        function check() {
            if (Atomics.load(lock, index) !== expected) {
                resolve('ok');
                return;
            }
            if (performance.now() - start > timeoutMs) {
                resolve('timed-out');
                return;
            }
            requestAnimationFrame(check);
        }
        check();
    });
}

/**
 * FXSuspend error class for async-to-sync bridge
 */
class FXSuspend extends Error {
    public tag = 'FX:SUSPEND';
    public promise: Promise<any>;
    
    constructor(promise: Promise<any>) {
        super('FX:SUSPEND');
        this.promise = promise;
    }
}

// Install globally if not present
if (!(globalThis as any).FXSuspend) {
    (globalThis as any).FXSuspend = FXSuspend;
}

/**
 * FXDisk-Aware Sync Module Loader
 * Compatible with fx.ts SyncModuleLoader interface
 */
export class FXDiskSyncLoader {
    private client: FXDiskClient | null = null;
    private worker: Worker | null = null;
    private sab: SharedArrayBuffer | null = null;
    private lock: Int32Array | null = null;
    private len: Int32Array | null = null;
    private buf: Uint8Array | null = null;
    private cache = new Map<string, string>();
    private TIMEOUT_MS = 15000;
    public cspMode = false;
    private moduleIntegrity = new Map<string, string>();
    private initialized = false;
    private vfsReady = false;
    private activeStreams = new Map<string, Promise<void>>();

    constructor(config: FXDiskSyncLoaderConfig = {}) {
        this.TIMEOUT_MS = config.timeoutMs ?? 15000;
        this.cspMode = this.detectCSP();
        
        // Initialize FXDisk client
        try {
            this.client = getFXDiskClient();
        } catch (e) {
            logger.warn('FXDisk client not available', e);
        }

        // Load bundle SYNCHRONOUSLY if provided
        if (config.bundleBase64) {
            this.loadBundleBase64Sync(config.bundleBase64);
        } else if (config.bundleUrl) {
            this.loadBundleSync(config.bundleUrl);
        }

        // Initialize Worker+SAB fallback (browser only, non-CSP)
        if (config.enableWorker !== false && 
            typeof SharedArrayBuffer !== 'undefined' && 
            !HAS_DENO && !HAS_NODE && !this.cspMode) {
            this.initWorker();
        }

        this.initialized = true;
    }

    /**
     * Load bundle synchronously via XHR (old school blocking)
     */
    private loadBundleSync(url: string): number {
        if (!this.client) {
            logger.warn('No FXDisk client for bundle load');
            return 0;
        }

        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, false); // SYNCHRONOUS
            xhr.responseType = 'arraybuffer';
            xhr.send();

            if (xhr.status !== 200) {
                throw new Error(`HTTP ${xhr.status}`);
            }

            const data = new Uint8Array(xhr.response as ArrayBuffer);
            const count = this.client.loadBundleSync(data);
            this.vfsReady = true;
            logger.info(`Bundle loaded sync: ${count} files from ${url}`);
            return count;
        } catch (e) {
            logger.error(`Failed to load bundle sync: ${url}`, e);
            return 0;
        }
    }

    /**
     * Load bundle from base64 synchronously
     */
    private loadBundleBase64Sync(base64: string): number {
        if (!this.client) {
            logger.warn('No FXDisk client for bundle load');
            return 0;
        }

        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            const count = this.client.loadBundleSync(bytes);
            this.vfsReady = true;
            logger.info(`Bundle loaded from base64: ${count} files`);
            return count;
        } catch (e) {
            logger.error('Failed to load bundle from base64', e);
            return 0;
        }
    }

    /**
     * Load bundle at runtime (sync)
     */
    loadBundle(urlOrBase64: string, isBase64 = false): number {
        if (isBase64) {
            return this.loadBundleBase64Sync(urlOrBase64);
        }
        return this.loadBundleSync(urlOrBase64);
    }

    private detectCSP(): boolean {
        try {
            new Function('return true')();
            return false;
        } catch {
            logger.info('CSP detected: using CSP-compatible mode');
            return true;
        }
    }

    private initWorker(): void {
        try {
            this.sab = new SharedArrayBuffer(2 * 1024 * 1024); // 2MB mailbox
            this.lock = new Int32Array(this.sab, 0, 1);
            this.len = new Int32Array(this.sab, 4, 1);
            this.buf = new Uint8Array(this.sab, 8);

            const code = `
                const te = new TextEncoder();
                self.onmessage = async (e) => {
                    const { id, url, sab } = e.data || {};
                    const lock = new Int32Array(sab, 0, 1);
                    const len = new Int32Array(sab, 4, 1);
                    const buf = new Uint8Array(sab, 8);
                    try {
                        const res = await fetch(url);
                        if (!res.ok) throw new Error("HTTP " + res.status);
                        const txt = await res.text();
                        const enc = te.encode(txt);
                        if (enc.length > buf.length) {
                            Atomics.store(lock, 0, -id);
                            Atomics.notify(lock, 0, 1);
                            return;
                        }
                        buf.set(enc);
                        len[0] = enc.length;
                        Atomics.store(lock, 0, id);
                    } catch(_e) {
                        Atomics.store(lock, 0, -id);
                    }
                    Atomics.notify(lock, 0, 1);
                };
            `;

            const blob = new Blob([code], { type: 'application/javascript' });
            this.worker = new Worker(URL.createObjectURL(blob));
        } catch (e) {
            logger.warn('Worker initialization failed', e);
        }
    }

    /** Normalize path for VFS lookup */
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

    /** Check if FXDisk VFS has the file */
    private hasInVFS(path: string): boolean {
        if (!this.client || !this.vfsReady) {
            return false;
        }
        return this.client.exists(this.normalizePath(path));
    }

    /** Read from FXDisk VFS */
    private readFromVFS(path: string): string | null {
        if (!this.hasInVFS(path)) return null;
        
        try {
            const content = this.client!.readFileSync(this.normalizePath(path));
            this.cache.set(path, content);
            return content;
        } catch (e) {
            logger.debug(`VFS read failed: ${path}`, e);
            return null;
        }
    }

    /** Fetch via Worker+SAB (async internally, blocking externally) */
    private async fetchIntoCache(url: string, timeoutMs = this.TIMEOUT_MS): Promise<string> {
        // If no worker, use direct methods
        if (!this.worker || !this.sab || !this.lock || !this.len || !this.buf) {
            // Server-side: use file read
            if (IS_SERVER && (url.startsWith('./') || url.startsWith('/') || url.startsWith('../'))) {
                const filePath = url.startsWith('/') ? `.${url}` : url;
                try {
                    let text: string;
                    if (HAS_NODE) {
                        const fs = require('fs');
                        text = fs.readFileSync(filePath, 'utf8');
                    } else {
                        text = (globalThis as any).Deno.readTextFileSync(filePath);
                    }
                    this.cache.set(url, text);
                    return text;
                } catch (e: any) {
                    throw new Error(`[FXDisk] File not found: ${filePath}`);
                }
            }
            
            // Browser: async fetch
            const res = await fetch(url);
            if (!res.ok) throw new Error(`[FXDisk] HTTP ${res.status} for ${url}`);
            const text = await res.text();
            this.cache.set(url, text);
            return text;
        }

        // Worker path
        const id = Math.floor(Math.random() * 1e9);
        Atomics.store(this.lock, 0, 0);
        this.worker.postMessage({ id, url, sab: this.sab });

        if (isUIThread()) {
            const st = await uiFriendlyWait(this.lock, 0, 0, timeoutMs);
            if (st !== 'ok') throw new Error(`[FXDisk] Module load timeout ${url}`);
        } else {
            const r = Atomics.wait(this.lock, 0, 0, timeoutMs);
            if (r === 'timed-out') throw new Error(`[FXDisk] Module load timeout ${url}`);
        }

        const signal = Atomics.load(this.lock, 0);
        if (signal !== id) throw new Error(`[FXDisk] Worker error or buffer too small for ${url}`);
        
        const n = this.len![0];
        const text = new TextDecoder().decode(this.buf!.subarray(0, n));
        Atomics.store(this.lock, 0, 0);
        this.cache.set(url, text);
        return text;
    }

    /** Sync XHR fallback */
    private fetchSyncXHR(url: string): string {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false); // SYNCHRONOUS
        xhr.send();
        
        if (xhr.status === 200) {
            this.cache.set(url, xhr.responseText);
            return xhr.responseText;
        }
        
        throw new Error(`[FXDisk] HTTP ${xhr.status} for ${url}`);
    }

    /**
     * Async module load
     */
    async loadAsync(url: string, timeoutMs = this.TIMEOUT_MS): Promise<string> {
        // Check cache
        if (this.cache.has(url)) return this.cache.get(url)!;
        
        // Check VFS first
        const vfsContent = this.readFromVFS(url);
        if (vfsContent !== null) return vfsContent;
        
        // Fetch
        return await this.fetchIntoCache(url, timeoutMs);
    }

    /**
     * Synchronous module load - FX compatible
     * Priority: cache → VFS → Start Streaming → Suspend
     */
    loadSync(url: string): string {
        const normalized = this.normalizePath(url);

        // 1. Check cache
        if (this.cache.has(url)) {
            return this.cache.get(url)!;
        }

        // 2. PRIMARY PATH: Instant VFS Read
        if (this.client && this.client.exists(normalized)) {
            const content = this.client.readFileSync(normalized);
            this.cache.set(url, content);
            logger.debug(`VFS hit: ${url}`);
            return content;
        }

        // 3. CSP mode fallback
        if (this.cspMode) {
            logger.warn(`CSP mode: Cannot load ${url} synchronously`);
            return `/* FX_CSP_MODE: ${url} */\nexport default { __fx_csp_blocked: true, __fx_module_url: "${url}" };`;
        }

        // 4. Server-side: direct file read
        if (IS_SERVER && (url.startsWith('./') || url.startsWith('/') || url.startsWith('../'))) {
            const filePath = url.startsWith('/') ? `.${url}` : url;
            try {
                let text: string;
                if (HAS_NODE) {
                    const fs = require('fs');
                    text = fs.readFileSync(filePath, 'utf8');
                } else {
                    text = (globalThis as any).Deno.readTextFileSync(filePath);
                }
                this.cache.set(url, text);
                return text;
            } catch (e: any) {
                throw new Error(`[FXDisk] File not found: ${filePath}`);
            }
        }

        // 5. CHECK ACTIVE STREAMS - Prevent duplicate downloads during replay
        if (this.activeStreams.has(normalized)) {
            throw new FXSuspend(this.activeStreams.get(normalized)!);
        }

        // 6. START FLUID STREAMING - Stream directly into VFS
        if (this.client && isUIThread()) {
            const streamPromise = this.client.streamIntoVFS(url).then(() => {
                this.activeStreams.delete(normalized);
            }).catch((err) => {
                this.activeStreams.delete(normalized);
                logger.error(`Stream failed for ${url}`, err);
                throw err;
            });

            this.activeStreams.set(normalized, streamPromise);

            // SUSPEND EXECUTION - Let streaming happen in background
            throw new FXSuspend(streamPromise);
        }

        throw new Error(`[FXDisk] loadSync unexpected fallthrough: ${url}`);
    }

    /**
     * Load module from path (PluginManager compatibility)
     */
    loadFromPath(path: string): any {
        const code = this.loadSync(path);
        return this.executeModule(code, path);
    }

    /**
     * Execute module code
     */
    private executeModule(code: string, path: string): any {
        // Transform export syntax
        const transformed = code
            .replace(/export\s+default\s+/g, 'module.exports.default = ')
            .replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ')
            .replace(/\bexport\s+\{[^}]+\}/g, '');

        const module: { exports: Record<string, unknown> } = { exports: {} };
        const exports = module.exports;

        try {
            const fn = new Function('module', 'exports', 'require', transformed);
            const require = (depPath: string) => {
                const resolved = this.resolvePath(depPath, path);
                return this.loadFromPath(resolved);
            };
            fn.call(exports, module, exports, require);
            return module.exports.default ?? module.exports;
        } catch (e: any) {
            if (e.message?.includes('unsafe-eval')) {
                logger.warn(`CSP blocks execution for ${path}`);
                return { __fx_csp_blocked: true, __fx_module_url: path };
            }
            throw e;
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

    /** Set integrity hash for URL */
    setIntegrity(url: string, hash: string): void {
        this.moduleIntegrity.set(url, hash);
    }

    /** Get integrity hash */
    getIntegrity(url: string): string | undefined {
        return this.moduleIntegrity.get(url);
    }

    /** Add file to VFS (for runtime additions) */
    addToVFS(path: string, content: string): void {
        if (this.client) {
            this.client.addFile(path, content);
        }
        this.cache.set(path, content);
    }

    /** Check if file exists */
    exists(path: string): boolean {
        if (this.cache.has(path)) return true;
        return this.hasInVFS(path);
    }

    /** List files in VFS */
    listFiles(): string[] {
        if (this.client && this.vfsReady) {
            return this.client.listFiles();
        }
        return [];
    }

    /** Clear cache */
    clearCache(): void {
        this.cache.clear();
    }

    /** Get FXDisk client */
    getClient(): FXDiskClient | null {
        return this.client;
    }

    /** Get stats */
    getStats() {
        return {
            cacheSize: this.cache.size,
            vfsReady: this.vfsReady,
            vfsFiles: this.client ? this.client.listFiles().length : 0,
            hasWorker: !!this.worker,
            cspMode: this.cspMode,
        };
    }
}

// Export for direct use
export default FXDiskSyncLoader;
