/**
 * @file fx.ts
 * @version 1.0.0 "The Synthesis"
 * @description The definitive, unified FX Core Framework. This version integrates the
 * powerful Group Composition Engine directly into the core, providing reactive links,
 * live CSS-style selectors, and a complete set of data manipulation tools on every node.
 * It is a complete, isomorphic, single-file application operating system.
 *
 * Portable core for FX + FXD views:
 * Node graph + proxies + behaviors
 * Worker+SAB sync module loader (client), blocking fetch (server)
 * @-syntax (leading-@ returns module default; path@spec attaches or calls API)
 * .as<T>() typed unwrap; implicit reactive links
 * CSS-style selectors + reactive Groups (manual + include/exclude)
 * Config via $config.fx (+ runtime $system.fx overrides)
 * Optional Deno server for /fx/proxy and /fx/module (not OS-specific)
 * 
 * Architecture by: Charl Cronje
 *
 * Region Map (for fx-assemble):
 *   fx::env              — Environment detection & utilities        (kernel)
 *   fx::types            — Core interfaces & types                  (kernel)
 *   fx::suspend          — FXSuspend / replay / UI-safe wait        (kernel)
 *   fx::module-loader    — SyncModuleLoader (Worker+SAB)            (extractable)
 *   fx::plugin-manager   — PluginManager + ManifestConfig           (extractable)
 *   fx::core             — FXCore class (node graph engine)         (kernel)
 *   fx::proxy            — createNodeProxy + proxy handlers         (kernel)
 *   fx::config-helper    — fxCfg() config access helper             (extractable)
 *   fx::attach-namespace — attachNamespaceToNode type surfaces      (extractable)
 *   fx::http             — HTTP shortcuts + FutureProxy             (extractable)
 *   fx::at-syntax        — @-syntax / buildAtBinding / patchDollar  (extractable)
 *   fx::selector-engine  — CSS-style selector parser & matcher      (extractable)
 *   fx::groups           — Reactive Group system + wrapGroup        (extractable)
 *   fx::bootstrap        — Globals & bootstrapping ($$ etc)         (kernel)
 *   fx::deno-server      — Optional Deno HTTP server                (extractable)
 *   fx::global-decl      — TypeScript global declarations           (kernel)
 */

// #region fx::env
//////////////////////////////
// Environment & Utilities //
//////////////////////////////

const HAS_DENO = typeof (globalThis as any).Deno !== "undefined";
const HAS_NODE = typeof (globalThis as any).process !== "undefined" && (globalThis as any).process.versions?.node;
const IS_SERVER = HAS_DENO || HAS_NODE;
const IS_CLIENT = !IS_SERVER;

const nowId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const isHttp = (u: string) => /^https?:\/\//i.test(u);
const isRel = (u: string) => u.startsWith("/") && !u.startsWith("//");
const toNumIfStr = (v: any) => (typeof v === "string" && v.trim() !== "" && isFinite(v as any)) ? parseFloat(v as any) : v;
const safeJson = (v: unknown) => { try { return JSON.stringify(v); } catch { return String(v); } };
const prop = (o: any, k: string, v: any, enumerable = false) =>
    Object.defineProperty(o, k, { value: v, configurable: true, writable: false, enumerable });
// #endregion fx::env

// #region fx::types
/////////////////////////////
// Proxy Identity Marker   //
/////////////////////////////

const FX_PROXY_MARKER = Symbol.for("fx:proxy");

/** Detect whether a value is an FXNodeProxy (reactive link target). */
const isProxy = (v: any): v is FXNodeProxy => !!v && v[FX_PROXY_MARKER] === true;

/////////////////////
// Core Structures //
/////////////////////

export interface FXNode {
    __id: string;
    __parent_id: string | null;
    __nodes: Record<string, FXNode>;
    __value: any;
    __type: string | null;
    // Fix #5: __proto is now a Map<string, BehaviorTable> merging the old __behaviors
    __proto: Map<string, any>;
    // Fix #6: __instances removed — class instances live in __value[ClassName]
    __effects: Function[];
    __watchers: Set<(nv: unknown, ov: unknown) => void>;
    __meta?: Record<string, any>;
}

export type FXMutableValue = unknown;

export type FXOpts = {
    default?: any;
    child?: string;
    cast?: "number" | "string" | "boolean" | "json" | ((v: any) => any);
    emptyAs?: Array<"undefined" | "null" | "NaN" | "" | 0 | false>;
    createIfMissing?: boolean;
};

export interface FXBuiltInViews {
    str(): string;
    num(): number;
    bool(): boolean;
    raw(): any;
}

export interface FXNodeProxy<V extends FXMutableValue = any, T = {}> extends FXBuiltInViews {
    (path: string, value?: any): FXNodeProxy<any, any>;

    val(): V;
    val(opts: FXOpts): V;
    val<NewV extends FXMutableValue>(newValue: NewV): FXNodeProxy<NewV, T>;
    val<NewV extends FXMutableValue>(newValue: NewV, opts: FXOpts): FXNodeProxy<NewV, T>;

    set<NewV extends FXMutableValue>(newValue: NewV): FXNodeProxy<NewV, T>;
    set<NewV extends FXMutableValue>(newValue: NewV, child: string): FXNodeProxy<NewV, T>;
    set<NewV extends FXMutableValue>(newValue: NewV, opts: FXOpts): FXNodeProxy<NewV, T>;
    set<NewV extends FXMutableValue>(newValue: NewV, child: string, opts: FXOpts): FXNodeProxy<NewV, T>;

    get(): V;
    get(defaultValue: any): V;
    get(defaultValue: any, opts: FXOpts): V;
    get(child: string): FXNodeProxy<any, any>;
    get(child: string, opts: FXOpts): FXNodeProxy<any, any>;
    get(defaultValue: any, child: string): FXNodeProxy<any, any>;
    get(defaultValue: any, child: string, opts: FXOpts): FXNodeProxy<any, any>;

    node(): FXNode;
    proxy(): this;
    type(): string | null;

    /** Type-safe instance unwrap: class or name; cross-realm tolerant */
    as<T>(ctorOrName: { new(...a: any[]): T } | string): T | null;

    inherit(...behaviors: any[]): this & T;
    watch(callback: (newValue: any, oldValue: any) => void): () => void;
    nodes(): { [key: string]: FXNodeProxy<any, any> };
}
// #endregion fx::types

// #region fx::suspend
//////////////////////////////////////
// UI-safe wait + suspend core (FX) //
//////////////////////////////////////
function isUIThread(): boolean {
    // @ts-ignore
    return typeof window !== "undefined" && !(typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope);
}

async function uiFriendlyWait(i32: Int32Array, idx: number, expected: number, timeout = Infinity): Promise<"ok" | "timed-out" | "not-equal"> {
    const anyAtomics: any = Atomics as any;
    if (typeof anyAtomics.waitAsync === "function") {
        const res = anyAtomics.waitAsync(i32, idx, expected, timeout);
        if (res?.async === false) return res.value;
        return await res.value;
    }

    const start = performance.now();
    while (true) {
        if (Atomics.load(i32, idx) !== expected) return "ok";
        if (timeout !== Infinity && performance.now() - start >= timeout) return "timed-out";
        await new Promise(requestAnimationFrame);
    }
}

// --- Suspend/Replay token + helpers ---
class FXSuspend extends Error {
    promise: Promise<any>;
    tag = "FX:SUSPEND";
    constructor(p: Promise<any>) { super("FX:SUSPEND"); this.promise = p; }
}
function isSuspend(e: unknown): e is FXSuspend {
    return !!e && typeof e === "object" && (e as any).tag === "FX:SUSPEND";
}
function schedule(fn: () => void) {
    console.log("fn", fn);
    Promise.resolve().then(fn);
}
function invokeWithSuspendReplay<T extends (...a: any[]) => any>(fn: T, thisArg: any, args: any[]): any {
    const run = () => {
        try { return fn.apply(thisArg, args); }
        catch (e) {
            if (isSuspend(e)) { e.promise.then(() => schedule(run), () => schedule(run)); return undefined; }
            throw e;
        }
    };
    return run();
}
// expose once for cross-file throws (fx-orm.ts, f-flow.ts)
(globalThis as any).FXSuspend = FXSuspend;
// #endregion fx::suspend

// #region fx::module-loader
/////////////////////////
// Sync Module Loader  //
/////////////////////////

/**
 * Minimal inline VFS for the kernel.
 * Stores files as strings keyed by normalized path.
 * Loaded from FXB bundles at boot, checked by SyncModuleLoader before network.
 */
class FXVfs {
    private files = new Map<string, string>();

    private normalizePath(path: string): string {
        return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
    }

    has(path: string): boolean {
        return this.files.has(this.normalizePath(path));
    }

    read(path: string): string {
        const n = this.normalizePath(path);
        const content = this.files.get(n);
        if (content === undefined) throw new Error(`[FX-VFS] File not found: ${path}`);
        return content;
    }

    set(path: string, content: string): void {
        this.files.set(this.normalizePath(path), content);
    }

    list(): string[] {
        return Array.from(this.files.keys());
    }

    count(): number {
        return this.files.size;
    }

    clear(): void {
        this.files.clear();
    }

    /**
     * Import an FXB bundle (binary format: [manifestLen:u32][manifestJSON][chunkData]).
     * Re-assembles files from the chunk store embedded in the bundle.
     * Returns the number of files imported.
     */
    importBundle(data: Uint8Array): number {
        if (data.length < 4) throw new Error('[FX-VFS] Invalid bundle: too short');

        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const manifestLen = view.getUint32(0, true);
        if (data.length < 4 + manifestLen) throw new Error('[FX-VFS] Invalid bundle: truncated manifest');

        const manifestBytes = data.subarray(4, 4 + manifestLen);
        const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
        const chunkData = data.subarray(4 + manifestLen);

        // Rebuild the chunk store: chunks are packed as [len:u32][bytes...]
        const chunks: Uint8Array[] = [];
        let offset = 0;
        while (offset + 4 <= chunkData.length) {
            const chunkView = new DataView(chunkData.buffer, chunkData.byteOffset + offset, 4);
            const cLen = chunkView.getUint32(0, true);
            offset += 4;
            if (offset + cLen > chunkData.length) break;
            chunks.push(chunkData.subarray(offset, offset + cLen));
            offset += cLen;
        }

        const decoder = new TextDecoder();
        let count = 0;

        for (const entry of (manifest.files || [])) {
            try {
                // Assemble file from its chunk indices
                const parts: Uint8Array[] = [];
                let totalLen = 0;
                for (const idx of (entry.chunks || [])) {
                    if (typeof idx === 'number' && idx < chunks.length) {
                        parts.push(chunks[idx]);
                        totalLen += chunks[idx].length;
                    } else if (typeof idx === 'string') {
                        // chunk hashes — find by index position (bundles store sequential)
                        // Fall through to raw assembly
                    }
                }

                let assembled: Uint8Array;
                if (parts.length > 0) {
                    assembled = new Uint8Array(totalLen);
                    let pos = 0;
                    for (const p of parts) {
                        assembled.set(p, pos);
                        pos += p.length;
                    }
                } else {
                    continue; // skip files we cannot reassemble
                }

                // Decompress LZ4 if needed (simple frame: magic 0x04224D18)
                if (entry.compression === 'lz4' && assembled.length >= 4) {
                    // Attempt LZ4 frame decompression
                    // For now, store raw — the full LZ4 decompressor lives in fx-disk.
                    // If the bundle was created with compression, the chunks are already
                    // decompressed at export time by VirtualFileSystem.readFile.
                    // Bundles exported via fx-disk store compressed chunks, so we need
                    // a minimal LZ4 block decode here.
                    assembled = fxVfsLz4Decompress(assembled, entry.size || assembled.length);
                }

                this.files.set(entry.path, decoder.decode(assembled));
                count++;
            } catch (e) {
                // Skip files that fail to import — log in debug
                if (typeof console !== 'undefined') {
                    console.debug?.('[FX-VFS] Skipped file:', entry.path, e);
                }
            }
        }
        return count;
    }
}

/**
 * Minimal LZ4 block decompressor for VFS bundle import.
 * Handles LZ4 frames (magic 0x184D2204) with single blocks.
 */
function fxVfsLz4Decompress(src: Uint8Array, originalSize: number): Uint8Array {
    // Check for LZ4 frame magic number
    if (src.length < 7 ||
        src[0] !== 0x04 || src[1] !== 0x22 || src[2] !== 0x4D || src[3] !== 0x18) {
        // Not LZ4 framed — return as-is (may already be uncompressed)
        return src;
    }

    // Simple LZ4 block decode
    // Skip frame header: magic(4) + FLG(1) + BD(1) + optional fields + HC(1)
    const flg = src[4];
    const hasContentSize = (flg >> 3) & 1;
    let headerSize = 7; // magic + FLG + BD + HC minimum
    if (hasContentSize) headerSize += 8; // content size field
    // Additional optional fields may exist; for typical FXB bundles this suffices

    if (headerSize >= src.length) return src; // malformed, return as-is

    // Read block size (u32 LE)
    if (headerSize + 4 > src.length) return src;
    const blockView = new DataView(src.buffer, src.byteOffset + headerSize, 4);
    const blockSize = blockView.getUint32(0, true) & 0x7FFFFFFF; // mask off highest bit
    const isUncompressed = (blockView.getUint32(0, true) & 0x80000000) !== 0;

    const blockStart = headerSize + 4;
    if (blockStart + blockSize > src.length) return src;

    if (isUncompressed) {
        return src.subarray(blockStart, blockStart + blockSize);
    }

    // LZ4 block decompress
    const dst = new Uint8Array(originalSize);
    let sIdx = blockStart;
    let dIdx = 0;
    const sEnd = blockStart + blockSize;

    while (sIdx < sEnd && dIdx < originalSize) {
        const token = src[sIdx++];
        // Literal length
        let litLen = (token >> 4) & 0x0F;
        if (litLen === 15) {
            let b: number;
            do { b = src[sIdx++]; litLen += b; } while (b === 255 && sIdx < sEnd);
        }
        // Copy literals
        for (let i = 0; i < litLen && sIdx < sEnd && dIdx < originalSize; i++) {
            dst[dIdx++] = src[sIdx++];
        }
        if (sIdx >= sEnd) break;
        // Match offset (u16 LE)
        const matchOff = src[sIdx] | (src[sIdx + 1] << 8);
        sIdx += 2;
        if (matchOff === 0) break;
        // Match length
        let matchLen = (token & 0x0F) + 4;
        if ((token & 0x0F) === 15) {
            let b: number;
            do { b = src[sIdx++]; matchLen += b; } while (b === 255 && sIdx < sEnd);
        }
        // Copy match
        let matchPos = dIdx - matchOff;
        for (let i = 0; i < matchLen && dIdx < originalSize; i++) {
            dst[dIdx++] = dst[matchPos++];
        }
    }

    return dst.subarray(0, dIdx);
}

/** Global VFS instance — checked by SyncModuleLoader before network requests */
const fxVfs = new FXVfs();

/**
 * Load an FXB bundle into the kernel VFS.
 * Call this at boot, BEFORE any plugin loading.
 *
 * @param source - A URL string, a base64-encoded string, or raw Uint8Array bundle data
 * @returns Promise resolving to the number of files loaded
 */
async function fxBootBundle(source: string | Uint8Array): Promise<number> {
    let data: Uint8Array;

    if (source instanceof Uint8Array) {
        data = source;
    } else if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('/') || source.startsWith('./')) {
        // URL — fetch it
        const res = await fetch(source);
        if (!res.ok) throw new Error(`[FX] Failed to fetch bundle: HTTP ${res.status}`);
        data = new Uint8Array(await res.arrayBuffer());
    } else {
        // Assume base64
        const bin = atob(source);
        data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    }

    const count = fxVfs.importBundle(data);
    console.info(`[FX] VFS boot: loaded ${count} files from bundle`);
    return count;
}

/**
 * Synchronous variant — load a Uint8Array bundle into the VFS immediately.
 */
function fxBootBundleSync(data: Uint8Array): number {
    if (data.length >= 4 && data[0] === 70 && data[1] === 88 && data[2] === 66 && data[3] === 0) {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const fileCount = view.getUint32(6, true);
        let offset = 10;
        let loaded = 0;
        const decoder = new TextDecoder();
        for (let i = 0; i < fileCount; i++) {
            if (offset + 2 > data.length) break;
            const pathLen = view.getUint16(offset, true); offset += 2;
            if (offset + pathLen > data.length) break;
            const path = decoder.decode(data.subarray(offset, offset + pathLen)); offset += pathLen;
            if (offset + 5 > data.length) break;
            const dataLen = view.getUint32(offset, true); offset += 4;
            offset += 1;
            if (offset + dataLen > data.length) break;
            const content = decoder.decode(data.subarray(offset, offset + dataLen)); offset += dataLen;
            fxVfs.set(path, content);
            loaded++;
        }
        console.info(`[FX] VFS boot: loaded ${loaded} files from bundle`);
        return loaded;
    }
    const count = fxVfs.importBundle(data);
    console.info(`[FX] VFS boot (sync): loaded ${count} files from bundle`);
    return count;
}

// Expose on globalThis for early boot scripts
(globalThis as any).fxVfs = fxVfs;
(globalThis as any).fxBootBundle = fxBootBundle;
(globalThis as any).fxBootBundleSync = fxBootBundleSync;

// Auto-load bundle.fxb on client — sync XHR so VFS is ready before any plugin loading
if (!IS_SERVER) {
    try {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/fx/bundle.fxb", false);
        xhr.overrideMimeType("text/plain; charset=x-user-defined");
        xhr.send();
        if (xhr.status === 200 && xhr.responseText) {
            const raw = xhr.responseText; const data = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i) & 0xff; fxBootBundleSync(data);
        }
    } catch { /* bundle not available */ }
}

class SyncModuleLoader {
    private getNodeModules(): { fs: any; path: any } {
        if (!HAS_NODE) {
            throw new Error('Node modules requested outside Node environment');
        }
        const globalRequire = (globalThis as any).require || (globalThis as any).module?.require;
        if (!globalRequire) {
            throw new Error('require is not available in this runtime');
        }
        return {
            fs: globalRequire('fs'),
            path: globalRequire('path'),
        };
    }
    private worker: Worker | null = null;
    private sab: SharedArrayBuffer | null = null;
    private lock: Int32Array | null = null;
    private len: Int32Array | null = null;
    private buf: Uint8Array | null = null;
    private cache = new Map<string, string>();
    private TIMEOUT_MS = 15000;
    private cspMode: boolean = false;
    private moduleIntegrity = new Map<string, string>();

    constructor() {
        // Detect CSP restrictions
        this.cspMode = this.detectCSP();

        // Skip Worker initialization in Deno/Node/server environments
        // Only initialize Worker in browser if not in CSP mode
        if (typeof SharedArrayBuffer !== "undefined" && !HAS_DENO && !HAS_NODE && !this.cspMode) {
            this.initWorker();
        }
    }

    private detectCSP(): boolean {
        try {
            // Try to use eval to detect if CSP blocks it
            new Function('return true')();
            return false;
        } catch (e) {
            console.info('[FX] CSP detected: unsafe-eval blocked. Using CSP-compatible mode.');
            return true;
        }
    }

    private initWorker() {
        this.sab = new SharedArrayBuffer(2 * 1024 * 1024); // 2MB mailbox
        this.lock = new Int32Array(this.sab, 0, 1);
        this.len = new Int32Array(this.sab, 4, 1);
        this.buf = new Uint8Array(this.sab, 8);

        const code = `
        const te = new TextEncoder();
        self.onmessage = async (e) => {
          const { id, url, sab } = e.data || {};
          const lock = new Int32Array(sab, 0, 1);
          const len  = new Int32Array(sab, 4, 1);
          const buf  = new Uint8Array(sab, 8);
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("HTTP " + res.status);
            const txt = await res.text();
            const enc = te.encode(txt);
            if (enc.length > buf.length) { Atomics.store(lock, 0, -id); Atomics.notify(lock, 0, 1); return; }
            buf.set(enc); len[0] = enc.length; Atomics.store(lock, 0, id);
          } catch(_e) { Atomics.store(lock, 0, -id); }
          Atomics.notify(lock, 0, 1);
        };
      `;

        // Check if we're in Deno and use module worker
        if (typeof (globalThis as any).Deno !== "undefined") {
            // For Deno, we need to create a temporary file or use a data URL with module type
            const dataUrl = `data:application/javascript,${encodeURIComponent(code)}`;
            this.worker = new Worker(dataUrl, { type: "module" });
        } else {
            // Browser environment - use classic worker
            this.worker = new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })));
        }
    }

    private async fetchIntoCache(url: string, timeoutMs = this.TIMEOUT_MS): Promise<string> {
        // Fallback to direct fetch if worker not available
        if (!this.worker || !this.sab || !this.lock || !this.len || !this.buf) {
            // Server-side: use synchronous file read
            if (IS_SERVER && (url.startsWith('./') || url.startsWith('/') || url.startsWith('../'))) {
                const filePath = url.startsWith('/') ? `.${url}` : url;
                try {
                    let text;
                    if (HAS_DENO) {
                        // Deno
                        text = (globalThis as any).Deno.readTextFileSync(filePath);
                    } else {
                        // Node.js
                        const { fs } = this.getNodeModules();
                        text = fs.readFileSync(filePath, 'utf8');
                    }
                    this.cache.set(url, text);
                    return text;
                } catch (e: any) {
                    throw new Error(`[FX] File not found: ${filePath}`);
                }
            }
            const res = await fetch(url);
            if (!res.ok) throw new Error(`[FX] HTTP ${res.status} for ${url}`);
            const text = await res.text();
            this.cache.set(url, text);
            return text;
        }

        const id = Math.floor(Math.random() * 1e9);
        Atomics.store(this.lock, 0, 0);
        this.worker.postMessage({ id, url, sab: this.sab });

        if (isUIThread()) {
            const st = await uiFriendlyWait(this.lock, 0, 0, timeoutMs);
            if (st !== "ok") throw new Error("[FX] Module load timeout " + url);
        } else {
            const r = Atomics.wait(this.lock, 0, 0, timeoutMs);
            if (r === "timed-out") throw new Error("[FX] Module load timeout " + url);
        }

        const signal = Atomics.load(this.lock, 0);
        if (signal !== id) throw new Error("[FX] Worker error or buffer too small for " + url);
        const n = this.len[0];
        const text = new TextDecoder().decode(this.buf.subarray(0, n));
        Atomics.store(this.lock, 0, 0);
        this.cache.set(url, text);
        return text;
    }

    async loadAsync(url: string, timeoutMs = this.TIMEOUT_MS): Promise<string> {
        if (this.cache.has(url)) return this.cache.get(url)!;
        return await this.fetchIntoCache(url, timeoutMs);
    }

    // UI: never block — start fetch and SUSPEND; Proxy will replay. Worker/Node: safe blocking.
    loadSync(url: string): string {
        if (this.cache.has(url)) return this.cache.get(url)!;

        // VFS check — try multiple path variations to find the file
        {
            const variants = [
                url,
                url.replace(/^\.\//, '').replace(/^\//, ''),                    // strip leading ./ or /
                url.replace(/^\.\/fx\//, '').replace(/^\/fx\//, ''),             // strip ./fx/ or /fx/
                url.replace(/\.ts$/, '.js'),                                      // .ts → .js
                url.replace(/^\.\//, '').replace(/\.ts$/, '.js'),                // strip ./ + .ts → .js
                url.replace(/^\.\/fx\//, '').replace(/\.ts$/, '.js'),            // strip ./fx/ + .ts → .js
                'fx/' + url.replace(/^\.\//, '').replace(/^\//, ''),             // add fx/ prefix
                url.replace(/^\.\//, '').replace(/^\//, '').replace(/^fx\//, '').replace(/\.ts$/, '.js'), // strip everything + .ts → .js
            ];
            for (const v of variants) {
                if (fxVfs.has(v)) {
                    const content = fxVfs.read(v);
                    this.cache.set(url, content);
                    return content;
                }
            }
        }

        // In CSP mode, we can't use new Function, so return a marker
        if (this.cspMode) {
            console.warn(`[FX] CSP mode: Cannot load ${url} synchronously. Use async loading instead.`);
            // Return a special marker that can be detected by the module loader
            return `/* FX_CSP_MODE: ${url} */\nexport default { __fx_csp_blocked: true, __fx_module_url: "${url}" };`;
        }

        if (isUIThread()) {
            // Synchronous XHR — blocks until file arrives, no FXSuspend needed
            try {
                const xhr = new XMLHttpRequest();
                xhr.open("GET", url, false);
                xhr.send();
                if (xhr.status === 200 || xhr.status === 0) {
                    this.cache.set(url, xhr.responseText);
                    return xhr.responseText;
                }
            } catch { /* sync XHR failed, fall through to FXSuspend */ }

            const p = this.fetchIntoCache(url).catch(() => { });
            throw new (globalThis as any).FXSuspend(p);
        }

        // Server-side: read file synchronously (no worker needed)
        if (IS_SERVER && (url.startsWith('./') || url.startsWith('/') || url.startsWith('../'))) {
            const filePath = url.startsWith('/') ? `.${url}` : url;
            try {
                let text: string;
                if (HAS_DENO) {
                    text = (globalThis as any).Deno.readTextFileSync(filePath);
                } else {
                    const { fs } = this.getNodeModules();
                    text = fs.readFileSync(filePath, 'utf8');
                }
                this.cache.set(url, text);
                return text;
            } catch {
                throw new Error(`[FX] File not found: ${filePath}`);
            }
        }

        // Worker path: fetchIntoCache will use Atomics.wait and return with cache filled
        let got = "";
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        (async () => { got = await this.fetchIntoCache(url); })();
        if (this.cache.has(url)) return this.cache.get(url)!;
        throw new Error("[FX] worker loadSync unexpected fallthrough");
    }

    // Add async loading method for CSP environments
    async loadModule(url: string): Promise<any> {
        if (IS_SERVER) {
            // Server-side: use dynamic import
            return import(url);
        } else {
            // Client-side: use dynamic import or script injection
            try {
                return await import(url);
            } catch (e) {
                // Fallback to script injection for browsers that don't support dynamic import
                return new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.type = 'module';
                    script.src = url;
                    script.onload = () => resolve(null);
                    script.onerror = reject;
                    document.head.appendChild(script);
                });
            }
        }
    }

    // Add integrity checking for loaded modules
    setIntegrity(url: string, hash: string): void {
        this.moduleIntegrity.set(url, hash);
    }

    getIntegrity(url: string): string | undefined {
        return this.moduleIntegrity.get(url);
    }
}
// #endregion fx::module-loader

// #region fx::plugin-manager
//////////////////////
// Plugin Management//
//////////////////////

interface ManifestPlugin {
    path: string;
    callback?: string;
    config?: Record<string, any>;
    description?: string;
}

interface ManifestConfig {
    plugins?: Record<string, ManifestPlugin | string>;
    modules?: Record<string, string>;
    config?: {
        lazyLoad?: boolean;
        cacheModules?: boolean;
        autoRegister?: boolean;
        logLoading?: boolean;
        timeout?: number;
    };
    environment?: Record<string, any>;
}

class PluginManager {
    private fx: FXCore;
    private loaded = new Map<string, any>();
    private prefix = new Map<string, FXNodeProxy>();
    private manifest: ManifestConfig | null = null;
    private lazyProxies = new Map<string, any>();

    constructor(fx: FXCore) {
        this.fx = fx;
        // Defer manifest loading until after FXCore is fully initialized
        setTimeout(() => this.loadManifest(), 0);
    }

    /**
     * Loads the .fxrc.json manifest file if it exists
     */
    private loadManifest() {
        try {
            if (IS_SERVER) {
                // Try to load manifest file
                let manifestPath = '.fxrc.json';
                let manifestContent: string | null = null;

                if (HAS_DENO) {
                    try {
                        manifestContent = (Deno as any).readTextFileSync('./.fxrc.json');
                    } catch {
                        try {
                            manifestContent = (Deno as any).readTextFileSync('./fx/.fxrc.json');
                        } catch {
                            // File doesn't exist
                        }
                    }
                } else if (HAS_NODE) {
                    const fs = require('fs');
                    const path = require('path');
                    manifestPath = path.resolve(process.cwd(), '.fxrc.json');
                    if (fs.existsSync(manifestPath)) {
                        manifestContent = fs.readFileSync(manifestPath, 'utf8');
                    } else {
                        manifestPath = path.resolve(process.cwd(), 'fx/.fxrc.json');
                        if (fs.existsSync(manifestPath)) {
                            manifestContent = fs.readFileSync(manifestPath, 'utf8');
                        }
                    }
                }

                if (manifestContent) {
                    this.manifest = JSON.parse(manifestContent);
                    this.setupLazyLoading();

                    // Apply config if present
                    if (this.manifest?.config) {
                        const configNode = this.fx.proxy('config.fx.manifest');
                        configNode.val(this.manifest.config);
                    }

                    if (this.manifest?.config?.logLoading) {
                        console.log('[FX] Manifest loaded from .fxrc.json');
                    }
                }
            }
        } catch (error) {
            console.warn('[FX] Failed to load .fxrc.json manifest:', error);
        }
    }

    /**
     * Sets up lazy loading proxies for manifest entries
     */
    private setupLazyLoading() {
        if (!this.manifest) return;

        // Setup plugin lazy loading
        if (this.manifest.plugins) {
            for (const [name, pluginConfig] of Object.entries(this.manifest.plugins)) {
                const config = typeof pluginConfig === 'string'
                    ? { path: pluginConfig }
                    : pluginConfig;
                this.setupLazyProxy(name, config);
            }
        }

        // Setup module lazy loading
        if (this.manifest.modules) {
            for (const [name, modulePath] of Object.entries(this.manifest.modules)) {
                this.setupModuleLazyProxy(name, modulePath);
            }
        }
    }

    /**
     * Creates a lazy loading proxy for a plugin
     */
    private setupLazyProxy(name: string, pluginConfig: ManifestPlugin) {
        // Register a getter on globalThis for first-access lazy load (e.g., $dom, $).
        // On first read, delete the descriptor THEN load — buildAtBinding writes to
        // globalThis[name] during load, which would silently fail under a getter-only
        // property descriptor. Deleting first lets the assignment land.
        if (!name.startsWith('$')) return;

        const self = this;
        let loading = false;
        Object.defineProperty(globalThis, name, {
            get() {
                if (loading) return undefined; // re-entry guard during load
                if (self.lazyProxies.has(name)) return self.lazyProxies.get(name);

                loading = true;
                try {
                    delete (globalThis as any)[name];
                    const plugin = self.loadPlugin(name, pluginConfig);
                    self.lazyProxies.set(name, plugin);
                    // If buildAtBinding didn't set the global, set it ourselves.
                    if (!(name in globalThis) || (globalThis as any)[name] === undefined) {
                        (globalThis as any)[name] = plugin;
                    }
                    return (globalThis as any)[name] ?? plugin;
                } finally {
                    loading = false;
                }
            },
            set(value) {
                // Allow buildAtBinding (or anything else) to overwrite — replaces the lazy getter.
                Object.defineProperty(globalThis, name, {
                    value,
                    configurable: true,
                    enumerable: true,
                    writable: true,
                });
            },
            configurable: true,
            enumerable: false,
        });
    }

    /**
     * Creates a lazy loading proxy for a module
     */
    private setupModuleLazyProxy(name: string, modulePath: string) {
        const moduleNode = this.fx.proxy(`modules.${name}`);

        // Setup lazy loading via proxy
        Object.defineProperty(moduleNode, '__lazyLoad', {
            value: () => {
                if (!this.loaded.has(`module:${name}`)) {
                    const module = this.fx.moduleLoader.loadFromPath(modulePath);
                    this.loaded.set(`module:${name}`, module);
                    moduleNode.val(module);
                }
                return this.loaded.get(`module:${name}`);
            },
            writable: false,
            enumerable: false
        });
    }

    /**
     * Loads a plugin on demand
     */
    private loadPlugin(name: string, pluginConfig: ManifestPlugin): any {
        const logLoading = this.manifest?.config?.logLoading;
        if (logLoading) console.log(`[FX] Lazy loading ${name} from ${pluginConfig.path}`);

        const cleanName = name.startsWith('$') ? name.slice(1) : name;
        const mountPath = `plugins.${cleanName || 'root'}`;
        const node = this.fx.proxy(mountPath);

        try {
            // Use the same @-syntax pipeline that explicit $$("@./path.ts") uses.
            // This routes through SyncModuleLoader which checks the VFS bundle first,
            // then sync XHR — so it works in browser, Deno, and Node identically.
            const spec = pluginConfig.path.startsWith('./')
                ? pluginConfig.path
                : `./${pluginConfig.path}`;

            const baseNode = node.node();
            const binding = buildAtBinding(this.fx, baseNode, spec);

            // Equivalent to .options({ global: name }) — triggers actual load + global assignment.
            if (binding && typeof binding.options === 'function') {
                binding.options({ global: name, type: 'plugin' });
            }

            // Pull the now-loaded instance off the global the framework just set.
            const instance = (globalThis as any)[name] ?? node.val();

            // Apply plugin config if present
            if (pluginConfig.config) {
                this.fx.proxy(`${mountPath}.config`).val(pluginConfig.config);
            }

            // Execute callback if specified
            if (pluginConfig.callback) {
                try {
                    const cb = new Function('return ' + pluginConfig.callback)();
                    if (typeof cb === 'function') cb();
                } catch (e) {
                    console.warn(`[FX] Callback failed for ${name}:`, e);
                }
            }

            return instance;
        } catch (error) {
            console.error(`[FX] Failed to load plugin ${name} from ${pluginConfig.path}:`, error);
            return { error: `Failed to load: ${error}` };
        }
    }

    register<T extends object>(name: string, factoryOrObj: any, opts?: { global?: string; prefix?: string }) {
        if (this.loaded.has(name)) return this.fx.proxy(opts?.prefix ? `${opts.prefix}.${name}` : `plugins.${name}`) as FXNodeProxy<T>;
        const instance = typeof factoryOrObj === "function" ? factoryOrObj(this.fx) : factoryOrObj;
        const mount = opts?.prefix ? `${opts.prefix}.${name}` : `plugins.${name}`;
        const node = this.fx.proxy(mount);
        node.val(instance);
        if (instance && typeof instance === "object") this.fx.graftObject(node.node(), instance as any);
        this.loaded.set(name, instance);
        if (opts?.global) (globalThis as any)[opts.global] = node;
        if (opts?.prefix) this.prefix.set(opts.prefix, node);
        return node as FXNodeProxy<T>;
    }

    getByPrefix(prefix: string) { return this.prefix.get(prefix); }

    /**
     * Gets the loaded manifest
     */
    getManifest(): ManifestConfig | null { return this.manifest; }

    /**
     * Reloads the manifest (useful for hot reload in development)
     */
    reloadManifest() {
        this.manifest = null;
        this.lazyProxies.clear();
        this.loadManifest();
    }
}
// #endregion fx::plugin-manager

// #region fx::core
//////////////
// FX Core  //
//////////////

export class FXCore {
    public root: FXNode;
    public pluginManager: PluginManager;
    public moduleLoader: SyncModuleLoader;

    // parent map for O(1) ancestry checks
    private __parentMap = new Map<string, FXNode>();

    // structure event bus (batched)
    private __structureListeners = new Set<(e: { kind: "create" | "remove" | "move" | "mutate", node: FXNode, parent?: FXNode, key?: string }) => void>();
    private __batchTimer: any = null;
    private __batchedEvents: any[] = [];

    constructor() {
        this.root = this.createNode(null);
        this.moduleLoader = new SyncModuleLoader();
        this.pluginManager = new PluginManager(this);
        this.ensureSystemRoots();
        this.installDefaults();
    }

    ensureSystemRoots() {
        const mk = (n: string) => { if (!this.root.__nodes[n]) { const c = this.createNode(this.root.__id); this.root.__nodes[n] = c; this.__parentMap.set(c.__id, this.root); } };
        ["app", "config", "plugins", "modules", "atomics", "dom", "session", "system", "cache", "code", "views", "fs", "history"].forEach(mk);
    }

    installDefaults() {
        // default config (can be overridden by $system.fx.* at runtime)
        // Use direct node access instead of $_$$ to avoid circular dependency
        const configNode = this.setPath('config.fx', {}, this.root);
        this.set(configNode, {
            selectors: {
                // attribute resolution order
                attrResolution: ["meta", "type", "raw", "child"],
                // allowed attribute operators
                enabledAttrOps: ["=", "!=", "^=", "$=", "*="],
                // enable :has()
                enableHas: false,
                // .class matches both __type and __proto
                classMatchesType: true,
            },
            groups: {
                reactiveDefault: true,
                debounceMs: 20,
            },
            performance: {
                enableParentMap: true,
                structureBatchMs: 5,
            }
        });
    }

    public onStructure(cb: (e: { kind: "create" | "remove" | "move" | "mutate", node: FXNode, parent?: FXNode, key?: string }) => void) {
        this.__structureListeners.add(cb);
        return () => this.__structureListeners.delete(cb);
    }
    private emitStructure(e: any) {
        const ms = fxCfg('performance.structureBatchMs', 5);
        this.__batchedEvents.push(e);
        if (ms <= 0) return this.__flushStructure();
        if (this.__batchTimer) return;
        this.__batchTimer = setTimeout(() => this.__flushStructure(), ms);
    }
    private __flushStructure() {
        const list = this.__batchedEvents.splice(0);
        clearTimeout(this.__batchTimer); this.__batchTimer = null;
        for (const ev of list) for (const cb of Array.from(this.__structureListeners)) { try { cb(ev); } catch { } }
    }

    createNode(parentId: string | null): FXNode {
        return {
            __id: nowId(),
            __parent_id: parentId,
            __nodes: Object.create(null),
            __value: undefined,
            __type: null,
            // Fix #5: __proto is now Map<string, BehaviorTable>
            __proto: new Map(),
            __effects: [],
            __watchers: new Set(),
        };
    }

    graftObject(host: FXNode, obj: Record<string, any>) {
        for (const k of Object.keys(obj)) this.setPath(k, obj[k], host);
    }

    // Max depth for set → watcher → set reentry chains
    private static MAX_SET_DEPTH = 10;
    private __setDepth = 0;

    private _finishSet(node: FXNode, old: any) {
        // Guard: if a watcher callback calls .set() on the same or another node,
        // we allow it up to MAX_SET_DEPTH before breaking the chain.
        if (this.__setDepth >= FXCore.MAX_SET_DEPTH) {
            console.warn(`[FX] set() depth limit (${FXCore.MAX_SET_DEPTH}) reached — breaking watcher chain on node ${node.__id}`);
            return;
        }
        this.__setDepth++;
        try {
            this.triggerEffects(node, "after.set", "__value", node.__value);
            node.__watchers.forEach(cb => { try { cb(node.__value, old); } catch (e) { console.error(e); } });
            this.emitStructure({ kind: "mutate", node });
        } finally {
            this.__setDepth--;
        }
    }

    set(node: FXNode, value: any) {
        const old = node.__value;
        this.triggerEffects(node, "before.set", "__value", value);

        // FXNode link
        if (value && typeof value === "object") {
            const maybe = (value as any).node?.() ?? value;
            if (maybe?.__id && maybe.__nodes) {
                node.__type = "FXNode";
                node.__value = { raw: maybe, FXNode: maybe, string: `[FXNode ${maybe.__id}]`, boolean: true };
                return this._finishSet(node, old);
            }
        }
        // Class instance
        if (value && typeof value === "object" && value.constructor?.name !== "Object") {
            const cname = value.constructor?.name ?? "Instance";
            node.__type = cname;
            // Fix #6: Removed __instances.set — instance is already in __value[cname]
            // Fix #9: Renamed stringified → string
            node.__value = { [cname]: value, raw: value, string: safeJson(value), boolean: true };
            return this._finishSet(node, old);
        }
        // Plain object -> graft into subnodes, then clear parent value
        if (value && typeof value === "object" && value.constructor?.name === "Object") {
            node.__type = "object";
            this.graftObject(node, value);
            // Fix #3: After expansion into __nodes, parent is structural.
            // .val() returns undefined; use .get() to reconstruct.
            node.__value = undefined;
            return this._finishSet(node, old);
        }
        // Primitive/function -> view bag
        // Fix #9: Renamed keys to match spec: raw, string, num, boolean
        const bag = { raw: value, num: toNumIfStr(value), string: String(value), boolean: Boolean(value) };
        node.__type = (typeof bag.num === "number" && !Number.isNaN(bag.num)) ? "num" : "raw";
        node.__value = bag;
        return this._finishSet(node, old);
    }

    val(node: FXNode): any {
        if (!node) {
            console.error('[FX] val() called with undefined/null node');
            console.trace();
            return undefined;
        }
        const v = node.__value;
        if (v == null) return v;
        if (typeof v === "object" && "raw" in (v as any)) {
            const t = node.__type as string | undefined;
            if (t && (v as any)[t] !== undefined) return (v as any)[t];
            return (v as any).raw;
        }
        return v;
    }

    /**
     * Fix #4: Settle — reconstruct a plain JS object from a structural node's children.
     * Recursively walks __nodes and reads leaf values, producing a snapshot object.
     */
    settle(node: FXNode): any {
        const childKeys = Object.keys(node.__nodes);
        if (childKeys.length === 0) return this.val(node);

        const out: Record<string, any> = {};
        for (const k of childKeys) {
            const child = node.__nodes[k];
            const childValue = this.val(child);
            const grandKeys = Object.keys(child.__nodes);
            // If child is also structural (has sub-nodes but no scalar value), recurse
            if (childValue == null && child.__type === "object" && grandKeys.length > 0) {
                out[k] = this.settle(child);
            } else if (grandKeys.length > 0 && childValue == null) {
                // Non-object structural node — still recurse
                out[k] = this.settle(child);
            } else {
                out[k] = childValue;
            }
        }
        return out;
    }

    resolvePath(path: string, start: FXNode): FXNode | undefined {
        const keys = path.split(".").filter(Boolean);
        let cur: FXNode | undefined = start;
        for (const k of keys) {
            if (!cur) return;
            const v = this.val(cur);
            if (v?.__id) cur = v;
            if (!cur?.__nodes[k]) return;
            cur = cur.__nodes[k];
        }
        return cur;
    }

    setPath(path: string, value: any, start: FXNode): FXNode {
        const keys = path.split(".").filter(Boolean);
        let cur = start;
        for (const k of keys) {
            if (!cur.__nodes[k]) {
                const created = this.createNode(cur.__id);
                cur.__nodes[k] = created;
                this.__parentMap.set(created.__id, cur);
                this.emitStructure({ kind: "create", node: created, parent: cur, key: k });
            }
            cur = cur.__nodes[k];
        }
        if (value !== undefined) this.set(cur, value);
        return cur;
    }

    findParentFast(n: FXNode) {
        if (!fxCfg('performance.enableParentMap', true)) return null;
        return this.__parentMap.get(n.__id) || null;
    }

    triggerEffects(node: FXNode, event: string, key: string, value: any) {
        const proxy = this.createNodeProxy(node);
        for (const eff of node.__effects) { try { eff(event, proxy, key, value); } catch (e) { console.error(e); } }
    }
    // #endregion fx::core

    // #region fx::proxy
    createNodeProxy<V extends FXMutableValue, T extends object>(node: FXNode): FXNodeProxy<V, T> {
        const self = this;

        declare const Deno: unknown;
        declare const require: unknown;
        const isOpts = (o: any): o is FXOpts => o && typeof o === "object" && "default" in o;
        const isEmpty = (v: any, opts?: FXOpts) => {
            const rules = opts?.emptyAs ?? ["undefined", "null"];
            for (const r of rules) {
                if (r === "undefined" && v === undefined) return true;
                if (r === "null" && v === null) return true;
                if (r === "NaN" && typeof v === "number" && Number.isNaN(v)) return true;
                if (r === "" && v === "") return true;
                if (r === 0 && v === 0) return true;
                if (r === false && v === false) return true;
            }
            return false;
        };
        const cast = (v: any, opts?: FXOpts) => {
            const c = opts?.cast;
            if (!c) return v;
            if (typeof c === "function") return c(v);
            switch (c) {
                case "number": return typeof v === "number" ? v : (v === "" || v == null ? NaN : Number(v));
                case "string": return String(v);
                case "boolean": return Boolean(v);
                case "json": try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return v; }
                default: return v;
            }
        };
        const ensureChild = (p: FXNode, k: string, create: boolean) => {
            let c = p.__nodes[k];
            if (!c && create) c = self.setPath(k, undefined, p);
            return c;
        };

        const baseFn = (path: string, value?: any): FXNodeProxy => {
            let target = self.resolvePath(path, node);
            if (!target) target = self.setPath(path, undefined, node);
            const proxy = self.createNodeProxy(target);
            if (value !== undefined) proxy.val(value);
            return proxy;
        };

        // Fix #9: Updated built-in view names to match new bag keys
        const builtViews: Record<string, string> = { str: "string", num: "num", bool: "boolean", raw: "raw" };

        const proxy = new Proxy(baseFn, {
            apply(_t, _thisArg, args: [string, any?]) { return baseFn(args[0], args[1]); },
            get(_t, key: string | symbol, receiver) {
                // Fix #1: isProxy detection via Symbol marker
                if (key === FX_PROXY_MARKER) return true;
                if (typeof key === "symbol") return undefined;

                if (key === "val") {
                    return function (a?: any, b?: FXOpts) {
                        const setter = !(a && isOpts(a));
                        if (setter && arguments.length >= 1) {
                            const value = a, opts = b && isOpts(b) ? b : undefined;

                            // implicit reactive link
                            if (isProxy(value)) {
                                const prev = (node as any).__linkFrom as undefined | { unwatch: () => void };
                                if (prev) try { prev.unwatch(); } catch { }
                                const fromNode = (value as FXNodeProxy).node();
                                const unwatch = (value as FXNodeProxy).watch((_nv: any) => {
                                    self.set(node, self.val(fromNode));
                                });
                                (node as any).__linkFrom = { unwatch };
                                self.set(node, self.val(fromNode));
                                return receiver;
                            }

                            const toSet = isEmpty(value, opts) ? opts?.default : value;
                            self.set(node, cast(toSet, opts));
                            return receiver;
                        }
                        const opts = a && isOpts(a) ? (a as FXOpts) : undefined;
                        let v = self.val(node);
                        if (isEmpty(v, opts)) v = opts?.default;
                        return cast(v, opts);
                    };
                }
                if (key === "set") {
                    return (value: any, b?: any, c?: FXOpts) => {
                        let child: string | undefined; let opts: FXOpts | undefined;
                        if (typeof b === "string") { child = b; opts = isOpts(c) ? c : undefined; } else { opts = isOpts(b) ? b : undefined; }
                        if (opts?.child && !child) child = opts.child;

                        // reactive link
                        if (isProxy(value)) {
                            const prev = (node as any).__linkFrom as undefined | { unwatch: () => void };
                            if (prev) try { prev.unwatch(); } catch { }
                            const fromNode = (value as FXNodeProxy).node();
                            const unwatch = (value as FXNodeProxy).watch((_nv: any) => self.set(node, self.val(fromNode)));
                            (node as any).__linkFrom = { unwatch };
                            self.set(node, self.val(fromNode));
                            return receiver;
                        }

                        const toSet = isEmpty(value, opts) ? opts?.default : value;
                        const cv = cast(toSet, opts);

                        if (child) {
                            const create = opts?.createIfMissing ?? true;
                            const cnode = ensureChild(node, child, create);
                            if (cnode) self.set(cnode, cv);
                            return receiver;
                        }
                        self.set(node, cv); return receiver;
                    };
                }
                if (key === "inherit") {
                    return (...behaviors: any[]) => {
                        for (const b of behaviors) {
                            if (b?.name) {
                                // Fix #5: Store in __proto Map (merged __behaviors)
                                node.__proto.set(b.name, b);
                                if (typeof b.effect === "function") node.__effects.push(b.effect);
                            }
                        }
                        return receiver;
                    };
                }
                if (key === "get") {
                    return (a?: any, b?: any, c?: FXOpts) => {
                        let def: any = undefined, child: string | undefined, opts: FXOpts | undefined;
                        if (typeof a === "string" && !isOpts(b)) { child = a; def = b; opts = isOpts(c) ? c : undefined; }
                        else { def = a; if (typeof b === "string") child = b; opts = isOpts(b) ? b : (isOpts(c) ? c : undefined); }
                        if (opts && opts.default !== undefined && def === undefined) def = opts.default;

                        if (child) {
                            const create = opts?.createIfMissing ?? true;
                            const cnode = ensureChild(node, child, create);
                            if (!cnode) return undefined;
                            return self.createNodeProxy(cnode);
                        }

                        // Fix #4: Settling — if node is structural (has children, no scalar value),
                        // reconstruct a plain object from __nodes recursively.
                        let v = self.val(node);
                        if (v == null && node.__type === "object" && Object.keys(node.__nodes).length > 0) {
                            v = self.settle(node);
                        }
                        if (isEmpty(v, opts)) v = def;
                        return cast(v, opts);
                    };
                }
                if (key === "node") return () => node;
                if (key === "proxy") return () => self.createNodeProxy(node);
                // Fix #7: .type() is now a getter/setter
                if (key === "type") return (newType?: string) => {
                    if (newType !== undefined) { node.__type = newType; return receiver; }
                    return node.__type;
                };

                if (key === "as") {
                    return <T>(ctorOrName: { new(...a: any[]): T } | string): T | null => {
                        const name = typeof ctorOrName === "string" ? ctorOrName : ctorOrName.name;

                        // Fix #6: Look up from __value bag instead of removed __instances
                        const bag = node.__value;
                        if (bag && typeof bag === "object" && name in bag) {
                            return bag[name] as T;
                        }

                        // Fall back to raw value check
                        const raw = self.val(node);
                        if (typeof ctorOrName !== "string" && raw instanceof ctorOrName) return raw as T;
                        if (raw && raw.constructor && raw.constructor.name === name) return raw as T;

                        // Fix #8: Check __proto behavior table for a type lens
                        if (node.__proto.has(name)) {
                            const behavior = node.__proto.get(name);
                            // Return a lens proxy that routes method calls through the behavior
                            return new Proxy({} as any, {
                                get(_t, prop: string) {
                                    if (behavior && typeof behavior[prop] === "function") {
                                        return (...args: any[]) => behavior[prop].call(receiver, ...args);
                                    }
                                    // Fall through to child nodes
                                    if (node.__nodes[prop]) return self.createNodeProxy(node.__nodes[prop]);
                                    return undefined;
                                }
                            }) as T;
                        }

                        return null;
                    };
                }

                if (key === "watch") return (cb: any) => { node.__watchers.add(cb); return () => node.__watchers.delete(cb); };
                if (key === "nodes") {
                    return () => {
                        const out: Record<string, FXNodeProxy<any, any>> = {};
                        for (const ck in node.__nodes) out[ck] = self.createNodeProxy(node.__nodes[ck]);
                        return out;
                    };
                }
                if (key in builtViews) return () => {
                    const v = node.__value;
                    if (v && typeof v === "object") return (v as any)[builtViews[key]];
                    return v as unknown;
                };

                // --- SELECT / GROUP API ---
                if (key === "select") {
                    return (selOrType?: string | string[]) => {
                        const g = new Group(self, node);
                        if (typeof selOrType === "string" && /[#\.\[:]/.test(selOrType)) {
                            g.selectCss(selOrType).reactiveMode(true);
                        } else if (selOrType) {
                            g.byType(...(Array.isArray(selOrType) ? selOrType : [selOrType]));
                        }
                        return wrapGroup(g.initSelection());
                    };
                }
                if (key === "group") {
                    return (paths?: string[]) => {
                        // Check if group already exists on node
                        if (!paths && (node as any).__group) {
                            return wrapGroup((node as any).__group);
                        }

                        // Create new group
                        const g = new Group(self, self.root);
                        if (paths) {
                            for (const p of paths) g.addPath(p);
                        }

                        // Store group on node for later retrieval
                        (node as any).__group = g;
                        return wrapGroup(g);
                    };
                }

                // Fix #5: Behavior lookup from __proto Map (merged __behaviors)
                if (node.__proto?.has(key)) {
                    const api = node.__proto.get(key);
                    return new Proxy(api, {
                        get(t, k: string) {
                            const m = (t as any)[k];
                            return typeof m === "function" ? m.bind(receiver) : m;
                        }
                    });
                }

                const cur = self.val(node);
                if (cur?.__id) return (self.createNodeProxy(cur) as any)[key];
                if (node.__nodes[key]) return self.createNodeProxy(node.__nodes[key]);

                return (baseFn as any)[key];
            },
            // Fix #2: Proxy set trap — enables $$.a.b.c = "val" assignment syntax
            set(_t, key: string | symbol, value: any): boolean {
                if (typeof key === "symbol") return false;
                // Ensure child node exists, then set its value
                let child = node.__nodes[key];
                if (!child) {
                    child = self.createNode(node.__id);
                    node.__nodes[key] = child;
                    self.__parentMap.set(child.__id, node);
                    self.emitStructure({ kind: "create", node: child, parent: node, key });
                }
                // Support reactive links: if value is a proxy, create a reactive link
                if (isProxy(value)) {
                    const fromNode = (value as FXNodeProxy).node();
                    const prev = (child as any).__linkFrom as undefined | { unwatch: () => void };
                    if (prev) try { prev.unwatch(); } catch { }
                    const unwatch = (value as FXNodeProxy).watch((_nv: any) => self.set(child!, self.val(fromNode)));
                    (child as any).__linkFrom = { unwatch };
                    self.set(child, self.val(fromNode));
                } else {
                    self.set(child, value);
                }
                return true;
            }
        });

        return proxy as any;
    }

    proxy(path?: string) {
        const root = this.createNodeProxy(this.root);
        return path ? (root(path) as FXNodeProxy) : root;
    }
    // #endregion fx::proxy
}

// #region fx::config-helper
//////////////////////////////
// Config access helper     //
//////////////////////////////

// Forward declaration - will be initialized later
let fx: FXCore;

const fxCfg = (path: string, fallback?: any) => {
    // Avoid using $_$$ during initialization - use fx directly if available
    if (!fx || !fx.root) return fallback;

    const sysNode = fx.resolvePath(`system.fx.${path}`, fx.root);
    if (sysNode) {
        const sys = fx.val(sysNode);
        if (sys !== undefined) return sys;
    }

    const cfgNode = fx.resolvePath(`config.fx.${path}`, fx.root);
    if (cfgNode) {
        const cfg = fx.val(cfgNode);
        if (cfg !== undefined) return cfg;
    }

    return fallback;
};
// #endregion fx::config-helper

// #region fx::attach-namespace
//////////////////////////////
// Type-surface Attachments //
//////////////////////////////

type AttachOptions = {
    type: string;
    global?: string;
    instantiateDefault?: boolean | { args?: any[] };
    mode?: "mixin+type" | "type-only" | "mixin-only";
    onConflict?: "keep-first" | "overwrite" | "warn-and-namespace";
};

function attachNamespaceToNode(
    fx: FXCore,
    node: FXNode,
    ns: any,
    opts: AttachOptions
) {
    const typeName = opts.type;
    if (!node.__nodes) node.__nodes = Object.create(null);

    const shape = (ns?.default && typeof ns.default === "object")
        ? { ...(ns.default), ...Object.fromEntries(Object.entries(ns).filter(([k]) => k !== "default")) }
        : ns;

    if (!node.__value || typeof node.__value !== "object" || !("raw" in (node.__value as any))) {
        node.__value = { raw: node.__value, string: String(node.__value), boolean: Boolean(node.__value) };
    }
    const bag = node.__value as Record<string, any>;
    bag[typeName] ??= {};

    if (node.__type == null) node.__type = typeName;
    else if (node.__type !== typeName && !node.__proto.has(typeName)) node.__proto.set(typeName, {});

    const attachFnToNode = (k: string, fn: Function) => {
        const sub = node.__nodes[k] || (node.__nodes[k] = fx.createNode(node.__id));
        (sub as any).__value = (...a: any[]) => fn(...a);
        prop(node, k, (...a: any[]) => fn(...a));
    };
    const attachValToNode = (k: string, v: any) => {
        const sub = node.__nodes[k] || (node.__nodes[k] = fx.createNode(node.__id));
        (sub as any).__value = v;
        Object.defineProperty(node, k, { configurable: true, enumerable: false, get: () => v });
    };
    const attachIntoTypeSurface = (k: string, v: any) => {
        const surface = bag[typeName];
        if (typeof v === "function") surface[k] = v.bind(surface);
        else surface[k] = v;
    };

    const onConflict = opts.onConflict ?? "warn-and-namespace";
    const allowMixin = (k: string) => {
        if (node.__nodes[k]) {
            if (onConflict === "overwrite") return true;
            if (onConflict === "warn-and-namespace") {
                // 'default' is the standard ESM export key — collisions are expected
                // when multiple plugins attach to the same parent. Don't spam.
                if (k !== "default") {
                    console.warn(`[FX] Mixin conflict on '${k}' (type '${typeName}'); preserving existing; available via .val().${typeName}.${k}`);
                }
                return false;
            }
            return false; // keep-first
        }
        return true;
    };

    for (const [k, v] of Object.entries(shape)) {
        attachIntoTypeSurface(k, v);
        if (opts.mode !== "type-only") {
            if (typeof v === "function") {
                if (allowMixin(k)) attachFnToNode(k, v);
            } else {
                if (!node.__nodes[k]) attachValToNode(k, v);
            }
        }
    }

    Object.defineProperty(node, typeName, {
        configurable: true,
        enumerable: false,
        get: () => (node.__value as any)[typeName],
    });
}
// #endregion fx::attach-namespace

// #region fx::http
/////////////////////////////
// HTTP (API) Shortcuts    //
/////////////////////////////

type HttpArgs = { method?: string; headers?: Record<string, string>; body?: any; global?: string };
const toHeaders = (h: Record<string, string>) => { const out = new Headers(); for (const k in h) out.set(k, h[k]); return out; };
const deserialize = (x: any) => (typeof x === "string" ? (() => { try { return JSON.parse(x); } catch { return x; } })() : x);

function serverFetch(url: string, method: string, headers: Record<string, string>, body?: any) {
    return fetch(url, {
        method,
        headers,
        body: body == null ? undefined :
            (typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body))
    });
}

type FutureOpts = { targetNode?: FXNode; globalName?: string; onResolve?: (v: any) => void };
function FutureProxy(fx: FXCore, promise: Promise<any>, opts: FutureOpts = {}) {
    const { targetNode, globalName, onResolve } = opts;
    const state = { resolved: false, value: undefined as any, error: undefined as any };
    promise.then(v => {
        state.resolved = true; state.value = v;
        if (targetNode) fx.set(targetNode, v);
        if (globalName) (globalThis as any)[globalName] = v;
        onResolve?.(v);
    }).catch(e => { state.resolved = true; state.error = e; if (targetNode) fx.set(targetNode, { error: String(e) }); });

    const handler: ProxyHandler<any> = {
        get(_t, prop) {
            if (prop === "then") return (cb: (v: any) => void) => { (!state.resolved) ? promise.then(cb) : cb(state.value); };
            if (prop === "await") return () => promise;
            if (!state.resolved) return undefined;
            const v = state.value, out = (v as any)?.[prop as any];
            return typeof out === "function" ? out.bind(v) : out;
        },
        apply(_t, _this, args) {
            if (!state.resolved) throw new Error("Future not resolved yet");
            if (typeof state.value === "function") return state.value(...args);
            throw new Error("Resolved value is not callable");
        }
    };
    const callable = function (...args: any[]) {
        if (!state.resolved) throw new Error("Future not resolved yet");
        if (typeof state.value === "function") return state.value(...args);
        return state.value;
    };
    return new Proxy(callable as any, handler);
}

function httpCall(url: string, method: string, args: HttpArgs | undefined, fx: FXCore, node: FXNode, forcedGlobal?: string) {
    const { headers = {}, body, global } = args || {};
    const g = forcedGlobal || global;

    if (IS_SERVER) {
        const p = serverFetch(url, method, headers, body).then(async r => {
            const ct = r.headers.get("content-type") || "";
            if (ct.includes("application/json")) return r.json();
            return r.text();
        }).then(deserialize);
        return FutureProxy(fx, p, { targetNode: node, globalName: g });
    }

    const sameOrigin = isRel(url) ? url : `/fx/proxy?url=${encodeURIComponent(url)}`;
    const p = fetch(sameOrigin, {
        method,
        headers: toHeaders(headers),
        body: body == null ? undefined : (typeof body === "string" || body instanceof Blob ? body : JSON.stringify(body))
    }).then(async r => {
        const ct = r.headers.get("content-type") || "";
        if (ct.includes("application/json")) return r.json();
        return r.text();
    }).then(deserialize);

    return FutureProxy(fx, p, { targetNode: node, globalName: g });
}
// #endregion fx::http

// #region fx::at-syntax
//////////////////////////
// @-syntax integration //
//////////////////////////

/**
 * Strip TypeScript syntax from source code so it can run in new Function().
 * Handles: interfaces, type aliases, enums, declare statements,
 * type annotations on parameters/variables, generics, and as/! casts.
 */
function stripTypeScript(src: string): string {
    const lines = src.split('\n');
    const result: string[] = [];
    let skipDepth = 0; // >0 means we're inside a block to skip

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Track brace depth for multi-line skipping
        if (skipDepth > 0) {
            skipDepth += (trimmed.match(/\{/g) || []).length;
            skipDepth -= (trimmed.match(/\}/g) || []).length;
            continue;
        }

        // Skip: interface blocks
        if (/^(export\s+)?interface\s+/.test(trimmed)) {
            if (trimmed.includes('{')) {
                skipDepth = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
            }
            continue;
        }

        // Skip: type alias (single-line and multi-line)
        if (/^(export\s+)?type\s+\w+/.test(trimmed) && !/^typeof\b/.test(trimmed)) {
            if (trimmed.includes('{') && !trimmed.includes('}')) {
                skipDepth = 1;
            }
            continue;
        }

        // Skip: enum blocks
        if (/^(export\s+)?enum\s+/.test(trimmed)) {
            if (trimmed.includes('{') && !trimmed.includes('}')) { skipDepth = 1; }
            continue;
        }

        // Skip: declare statements
        if (/^declare\s+/.test(trimmed)) continue;

        // Strip access modifiers on class properties/methods: private x → x
        let cleaned = line;
        cleaned = cleaned.replace(/\b(private|protected|public|readonly)\s+/g, '');

        // Strip optional param marker before colon: name?: Type → name
        cleaned = cleaned.replace(/(\w)\?\s*:/g, '$1:');

        // Strip type annotations on function params: (name: Type) → (name)
        // Careful: only match : followed by type-like tokens, not object literals
        cleaned = cleaned.replace(/(\w)\s*:\s*(?:string|number|boolean|any|void|never|unknown|null|undefined|object|symbol|bigint|Record|Map|Set|Array|Promise|Function|Partial|Required|Readonly|Pick|Omit|Exclude|Extract|NonNullable|ReturnType|InstanceType|Parameters|ConstructorParameters)[\w<>\[\]|&?,\s]*/g, '$1');

        // Generic return types after ): → )
        cleaned = cleaned.replace(/\)\s*:\s*[\w<>\[\]|&?,\s]+\s*(\{|=>)/g, ') $1');

        // Variable declarations: const x: Type = → const x =
        cleaned = cleaned.replace(/(const|let|var)\s+(\w+)\s*:\s*[\w<>\[\]|&?,\s]+\s*=/g, '$1 $2 =');

        // Property type annotations in objects after }: prop: Type; → prop;
        // Skip this — too risky

        // Generic type params: fn<Type>( → fn(
        cleaned = cleaned.replace(/(\w)<[\w\s,|&\[\]?:='"]+>\s*\(/g, '$1(');
        // new Map<K,V>() → new Map()
        cleaned = cleaned.replace(/(new\s+\w+)<[\w\s,|&\[\]?:='"]+>\s*\(/g, '$1(');

        // as casts: expr as Type → expr
        cleaned = cleaned.replace(/\s+as\s+[\w<>\[\]|&]+/g, '');

        // Non-null assertions
        cleaned = cleaned.replace(/(\w)!\./g, '$1.');
        cleaned = cleaned.replace(/(\w)!\s*([;,\)}\]])/g, '$1$2');

        // e: any at catch
        cleaned = cleaned.replace(/catch\s*\(\s*(\w+)\s*:\s*\w+\s*\)/g, 'catch ($1)');

        result.push(cleaned);
    }
    return result.join('\n');
}

function loadModuleSyncDefaultOrNS(fx: FXCore, specUrl: string) {
    // Try .js version first on server (pre-transpiled)
    let code: string;
    if (IS_SERVER && specUrl.endsWith('.ts')) {
        const jsUrl = specUrl.replace(/\.ts$/, '.js');
        try { code = fx.moduleLoader.loadSync(jsUrl); } catch { code = fx.moduleLoader.loadSync(specUrl); }
    } else {
        code = fx.moduleLoader.loadSync(specUrl);
    }
    const module: { exports: any } = { exports: {} };
    const exports = module.exports;

    const requireShim = (id: string) => {
        if (HAS_NODE) return (globalThis as any).require(id);
        return {};
    };

    // CSP-safe module execution with fallback
    try {
        // Try standard execution first
        const fn = new Function("module", "exports", "fx", "require", code);
        fn.call(exports, module, exports, fx, requireShim);
    } catch (e: any) {
        // If CSP blocks new Function, try alternative approaches
        if (e.message && e.message.includes('unsafe-eval')) {
            console.warn('[FX] CSP blocks new Function. Using dynamic import fallback.');
            // For CSP environments, we need to use dynamic import or script injection
            // This is a synchronous fallback that returns a promise marker
            return {
                __fx_async_module: true,
                __fx_module_url: specUrl,
                load: () => import(specUrl)
            };
        }
        throw e;
    }

    const ns = module.exports || {};
    const def = Object.prototype.hasOwnProperty.call(ns, "default") ? ns.default : undefined;

    if (typeof def === "function") {
        for (const [k, v] of Object.entries(ns)) if (k !== "default" && !(k in def)) prop(def, k, v);
        if (!("new" in def)) prop(def, "new", (...a: any[]) => new (def as any)(...a));
        prop(def, "ns", ns);
        return def;
    }
    if (def && typeof def === "object") {
        for (const [k, v] of Object.entries(ns)) if (k !== "default" && !(k in def)) prop(def, k, v);
        prop(def, "ns", ns);
        return def;
    }
    return ns;
}

type AttachOptionsFull = AttachOptions & { global?: string };

const atBindingCache = new Map<string, any>();

function buildAtBinding(fx: FXCore, baseNode: FXNode, spec: string) {
    const cacheKey = `${baseNode.__id}@${spec}`;
    if (atBindingCache.has(cacheKey)) {
        return atBindingCache.get(cacheKey);
    }

    // Check if it's a module file (ends with .js, .ts, .tsx, .jsx, .mjs)
    const isModuleFile = /\.(m?js|tsx?|jsx)$/i.test(spec);
    const isApi = !isModuleFile && (isHttp(spec) || isRel(spec));
    const ctx: { node: FXNode | undefined; ns: any; opts: AttachOptionsFull | any; loaded: boolean } = { node: baseNode, ns: undefined, opts: {}, loaded: false };

    // ==================================================================
    // FIX #1: THE PATCHED 'options' HELPER FUNCTION
    // This wrapper catches the `FXSuspend` error and allows the framework
    // to correctly replay the `.options()` call.
    // ==================================================================
    function options(o: Partial<AttachOptionsFull>) {
        ctx.opts = { ...ctx.opts, ...o };
        if (!ctx.loaded && !isApi) {
            loadModuleSync(spec);
        }
        return api;
    }

    // ==================================================================
    // FIX #2: THE PATCHED `loadModuleSync` FUNCTION
    // This version correctly strips the 'export' syntax from plugin code
    // before execution, preventing the `SyntaxError`.
    // ==================================================================
    function loadModuleSync(url: string) {
        if (ctx.loaded) return; // Already loaded

        let code;
        try {
            // On server, try .js version first (pre-transpiled, no TypeScript syntax)
            if (IS_SERVER && url.endsWith('.ts')) {
                const jsUrl = url.replace(/\.ts$/, '.js');
                try {
                    code = fx.moduleLoader.loadSync(jsUrl);
                    // Loaded pre-transpiled JS version
                } catch {
                    // No .js version, fall through to .ts
                    // No JS version, using TS
                    code = fx.moduleLoader.loadSync(url);
                }
            } else {
                code = fx.moduleLoader.loadSync(url);
            }
        } catch (e: any) {
            // If the error is FXSuspend, it must be re-thrown so the
            // invokeWithSuspendReplay wrapper can catch it.
            if (e?.tag === "FX:SUSPEND") {
                throw e;
            }
            // Otherwise, it's a real error (e.g., 404 Not Found)
            console.warn(`[FX] Failed to load module text for "${url}":`, e.message);
            ctx.loaded = true;
            ctx.ns = { default: null };
            return;
        }

        // Transpile TypeScript → JavaScript, then strip imports/exports for new Function()
        let jsCode = code;

        // Only strip TypeScript types if the code is actually TypeScript (has TS-specific syntax)
        // Pre-transpiled CJS from esbuild should NOT be stripped
        const looksLikeTS = code.includes('interface ') || code.includes(': string') || code.includes(': number') || code.includes('import type');
        const looksLikeCJS = code.includes('__toCommonJS') || code.includes('__defProp');
        if (IS_SERVER && looksLikeTS && !looksLikeCJS) {
            jsCode = stripTypeScript(code);
        }

        // Strip imports and exports for new Function() compatibility
        // For pre-transpiled CJS (.js), skip stripping — CJS doesn't use import/export
        const isCJS = jsCode.includes('__toCommonJS') || (jsCode.includes('module.exports') && !jsCode.includes('import '));
        const clientCode = isCJS ? jsCode : jsCode
            .replace(/^import\s+type\s+\{[^}]*\}\s+from\s+.*$/gm, '')
            .replace(/^import\s+type\s+.*$/gm, '')
            .replace(/^import\s+\{[^}]*\}\s+from\s+['"].*['"];?\s*$/gm, '')
            .replace(/^import\s+\*\s+as\s+\w+\s+from\s+['"].*['"];?\s*$/gm, '')
            .replace(/^import\s+\w+\s+from\s+['"].*['"];?\s*$/gm, '')
            .replace(/^import\s+['"].*['"];?\s*$/gm, '')
            .replace(/export\s+default\s+/g, 'module.exports.default = ')
            .replace(/(?<![_\w])export\s+/g, '');

        const module: { exports: any } = { exports: {} };
        const exports = module.exports;

        // Provide require() for CJS modules (esbuild output uses require for Node builtins)
        const requireShim = (id: string) => {
            if (HAS_DENO) {
                // Deno has Node compat — use createRequire
                try {
                    const { createRequire } = (globalThis as any).Deno?.internal?.node || {};
                    if (createRequire) return createRequire(import.meta.url)(id);
                } catch {}
                // Fallback: try dynamic import synchronously (won't work, but at least won't crash)
                return {};
            }
            if (HAS_NODE) {
                return (globalThis as any).require(id);
            }
            return {};
        };

        try {
            const fn = new Function("module", "exports", "fx", "require", clientCode);
            fn.call(exports, module, exports, fx, requireShim);
        } catch (e: any) {
            // Check if CSP is blocking eval
            if (e.message && e.message.includes('unsafe-eval')) {
                console.warn(`[FX] CSP blocks new Function for "${url}". Module loading disabled in strict CSP mode.`);
                // Mark module as async-only in CSP environments
                ctx.ns = {
                    default: null,
                    __fx_csp_blocked: true,
                    __fx_module_url: url,
                    loadAsync: () => import(url)
                };
            } else {
                // If we already loaded a .js version, this .ts error is expected — suppress it
                if (!ctx.loaded) {
                    console.error(`[FX] Error executing module code for "${url}". Check for syntax errors.`, e);
                }
                ctx.ns = ctx.ns || { default: null };
            }
            ctx.loaded = true;
            return;
        }


        if (ctx.opts?.instantiateDefault) {
            const d = module.exports.default;
            const isClass = typeof d === "function" && /^class\s/.test(Function.prototype.toString.call(d));
            if (isClass) {
                const args = typeof ctx.opts.instantiateDefault === "object" ? (ctx.opts.instantiateDefault.args ?? []) : [];
                module.exports.default = new d(...args);
            }
        }

        ctx.ns = module.exports;

        let instance = ctx.ns.default ?? ctx.ns;
        // Invoke the factory when:
        //   - type: "plugin" is explicit, OR
        //   - a global is being set (implies "this is a plugin, expose its API")
        // Plugin default exports are factories: `default function(fx, opts) { ...; return api; }`.
        // Without invocation, the global ends up as the factory itself, which is useless.
        const shouldInvokeFactory = typeof instance === 'function'
            && (ctx.opts?.type === 'plugin' || !!ctx.opts?.global);
        if (shouldInvokeFactory) {
            const isClass = /^class\s/.test(Function.prototype.toString.call(instance));
            try {
                instance = isClass ? new instance(fx, ctx.opts) : instance(fx, ctx.opts);
            } catch (e) {
                console.warn(`[FX] Plugin factory threw for "${spec}":`, e);
            }
        }

        attachNamespaceToNode(fx, ctx.node!, ctx.ns, { type: ctx.opts?.type || "module", ...ctx.opts });
        if (ctx.opts?.global) {
            (globalThis as any)[ctx.opts.global] = instance;
        }

        ctx.loaded = true;
    }


    // --- The rest of the original buildAtBinding function follows ---
    // (It has been slightly modified to use the replay wrapper correctly)

    function exportsProxy() {
        const handler: ProxyHandler<any> = {
            get(_t, prop) {
                if (prop === 'options') return options;

                // On any property access, ensure the module is loaded.
                invokeWithSuspendReplay(() => {
                    if (!ctx.loaded && !isApi) {
                        loadModuleSync(spec);
                    }
                }, null, []);

                if (isApi && typeof prop === "string" && ["get", "post", "put", "patch", "delete", "fetch"].includes(prop)) {
                    const meth = prop === "fetch" ? "GET" : prop.toUpperCase();
                    if (ctx.node?.__nodes[prop]) return fx.createNodeProxy(ctx.node.__nodes[prop]);
                    return (args?: HttpArgs) => httpCall(spec, meth, args, fx, ctx.node!, ctx.opts.global);
                }
                const val = (ctx.ns?.default && (ctx.ns.default as any)[prop]) ?? (ctx.ns as any)?.[prop];
                if (typeof val === "function") {
                    return new Proxy(val, {
                        apply(target, thisArg, argArray) {
                            return invokeWithSuspendReplay(target, ctx.ns.default ?? ctx.ns, argArray ?? []);
                        }
                    });
                }
                return val;
            },
            apply(_t, _this, args) {
                invokeWithSuspendReplay(() => {
                    if (!ctx.loaded && !isApi) {
                        loadModuleSync(spec);
                    }
                }, null, []);

                const d = ctx.ns?.default;
                if (typeof d === "function") {
                    return invokeWithSuspendReplay(d as any, ctx.ns.default ?? ctx.ns, args ?? []);
                }
                throw new Error("Default export is not callable.");
            }
        };

        const callable = function (...args: any[]) {
            invokeWithSuspendReplay(() => {
                if (!ctx.loaded && !isApi) {
                    loadModuleSync(spec);
                }
            }, null, []);

            const d = ctx.ns?.default;
            if (typeof d === "function") return d(...args);
            throw new Error("Default export is not callable.");
        };
        return new Proxy(callable as any, handler);
    }

    function fetchApi(url: string) {
        const callable: any = {};
        callable.fetch = (args?: HttpArgs) => httpCall(url, "GET", args, fx, ctx.node!, ctx.opts.global);
        callable.get = (args?: HttpArgs) => ctx.node?.__nodes["get"] ? fx.createNodeProxy(ctx.node.__nodes["get"]) : httpCall(url, "GET", args, fx, ctx.node!, ctx.opts.global);
        callable.post = (args?: HttpArgs) => ctx.node?.__nodes["post"] ? fx.createNodeProxy(ctx.node.__nodes["post"]) : httpCall(url, "POST", args, fx, ctx.node!, ctx.opts.global);
        callable.put = (args?: HttpArgs) => ctx.node?.__nodes["put"] ? fx.createNodeProxy(ctx.node.__nodes["put"]) : httpCall(url, "PUT", args, fx, ctx.node!, ctx.opts.global);
        callable.patch = (args?: HttpArgs) => ctx.node?.__nodes["patch"] ? fx.createNodeProxy(ctx.node.__nodes["patch"]) : httpCall(url, "PATCH", args, fx, ctx.node!, ctx.opts.global);
        callable.delete = (args?: HttpArgs) => ctx.node?.__nodes["delete"] ? fx.createNodeProxy(ctx.node.__nodes["delete"]) : httpCall(url, "DELETE", args, fx, ctx.node!, ctx.opts.global);
        callable.options = options;
        return callable;
    }

    const api: any = isApi ? fetchApi(spec) : exportsProxy();
    api.options = options;
    atBindingCache.set(cacheKey, api);
    return api;
}

function patchDollarAtSyntax(fx: FXCore) {
    const original = fx.proxy(); // root proxy
    const baseDollar = (path: string, value?: any) => {
        // Check for @ syntax: path@spec
        if (path.includes('@')) {
            const parts = path.split('@');
            const nodePath = parts[0];
            const spec = parts.slice(1).join('@'); // handle @ in URLs
            const node = nodePath ? fx.setPath(nodePath, undefined, fx.root) : fx.root;
            return buildAtBinding(fx, node, spec);
        }
        return original(path, value);
    };

    const dollar = new Proxy(baseDollar as any, {
        apply(_t, _this, args: [string]) {
            return invokeWithSuspendReplay(baseDollar as any, _this, args as any[]);
        },
        get(_t, key: string, receiver) {
            try {
                const val = Reflect.get(baseDollar as any, key, receiver);
                if (typeof val === "function") {
                    return new Proxy(val, {
                        apply(target, thisArg, argArray) {
                            return invokeWithSuspendReplay(target, thisArg, argArray ?? []);
                        }
                    });
                }
                return val;
            } catch (e: any) {
                if (e?.tag === "FX:SUSPEND") {
                    const suspend = e;
                    return new Proxy(function () { }, {
                        get() { throw suspend; },
                        apply() { throw suspend; },
                        construct() { throw suspend; }
                    });
                }
                throw e;
            }
        }
    });


    (globalThis as any).$$ = dollar;
    return dollar as FXNodeProxy;
}
// #endregion fx::at-syntax

// #region fx::selector-engine
//////////////////////////////
// Selector Engine (CSS-ish)//
//////////////////////////////

type SelSimple =
    | { kind: "class"; name: string }
    | { kind: "id"; id: string }
    | { kind: "attr"; key: string; op: "=" | "!=" | "^=" | "$=" | "*="; value: string }
    | { kind: "not"; inner: SelCompound }
    | { kind: "can"; inner: SelSimple }
    | { kind: "has"; inner: SelCompound };

type SelStep = { simple: SelSimple[] };
type SelCombinator = "desc" | "child";
type SelCompound = { chain: Array<SelStep | SelCombinator> };
type SelList = SelCompound[];

function parseSelector(input: string): SelList {
    const tokens = input.split(",").map(s => s.trim()).filter(Boolean);
    return tokens.map(parseOne);
}
function parseOne(s: string): SelCompound {
    const chain: Array<SelStep | SelCombinator> = [];
    let i = 0;
    const ws = () => { while (/\s/.test(s[i] || "")) i++; };
    const readIdent = () => { const m = /^[A-Za-z0-9_\-\$]+/.exec(s.slice(i)); if (!m) return ""; i += m[0].length; return m[0]; };
    const step: SelStep = { simple: [] };
    const pushStepIfNeeded = () => { if (step.simple.length) { chain.push({ simple: [...step.simple] }); step.simple.length = 0; } };

    while (i < s.length) {
        ws();
        const c = s[i];
        if (!c) break;
        if (c === '.') {
            i++; const name = readIdent(); step.simple.push({ kind: "class", name });
        } else if (c === '#') {
            i++; const id = readIdent(); step.simple.push({ kind: "id", id });
        } else if (c === '[') {
            i++; ws();
            const key = readIdent(); ws();
            let op: any = "=";
            if ("=!^$*".includes(s[i] || "")) {
                const allowed = new Set(fxCfg('selectors.enabledAttrOps', ["="]));
                if (s[i] === '=') { op = "="; i++; }
                else if (s[i] === '!' && s[i + 1] === '=') { i += 2; op = "!="; }
                else if (s[i] === '^' && s[i + 1] === '=') { i += 2; op = "^="; }
                else if (s[i] === '$' && s[i + 1] === '=') { i += 2; op = "$="; }
                else if (s[i] === '*' && s[i + 1] === '=') { i += 2; op = "*="; }
                if (!allowed.has(op)) op = "=";
            }
            ws();
            let value = "";
            if (s[i] === '"' || s[i] === "'") {
                const q = s[i++]; const start = i;
                while (i < s.length && s[i] !== q) i++;
                value = s.slice(start, i); i++;
            } else {
                const m = /^[^\]\s]+/.exec(s.slice(i)); value = m ? m[0] : ""; i += value.length;
            }
            ws(); if (s[i] === ']') i++;
            step.simple.push({ kind: "attr", key, op, value });
        } else if (c === ':') {
            i++; const id = readIdent(); ws();
            if (s[i] === '(') {
                i++;
                const inside = readBalanced();
                if (id === "not") {
                    const inner = parseOne(inside);
                    step.simple.push({ kind: "not", inner });
                } else if (id === "can") {
                    const innerAst = parseSelector(inside)[0];
                    const firstStep = innerAst?.chain?.find((x: any) => (x as any).simple) as SelStep;
                    const firstSimple = firstStep?.simple?.[0] as SelSimple;
                    if (firstSimple) step.simple.push({ kind: "can", inner: firstSimple });
                } else if (id === "has") {
                    const enabled = fxCfg('selectors.enableHas', false);
                    if (enabled) step.simple.push({ kind: "has", inner: parseOne(inside) });
                }
            }
            function readBalanced() {
                let depth = 1, out = "";
                while (i < s.length && depth > 0) {
                    if (s[i] === '(') depth++;
                    else if (s[i] === ')') depth--;
                    if (depth > 0) out += s[i];
                    i++;
                }
                return out.trim();
            }
        } else if (c === '>') {
            pushStepIfNeeded(); chain.push("child"); i++;
        } else if (/\s/.test(c)) {
            pushStepIfNeeded();
            if (chain.length && chain[chain.length - 1] !== "desc") chain.push("desc");
            ws();
        } else {
            i++;
        }
    }
    pushStepIfNeeded();
    return { chain };
}

function matchSimple(fx: FXCore, node: FXNode, s: SelSimple): boolean {
    if (s.kind === "class") {
        const t = node.__type;
        // Fix #5: __proto is now a Map — use .has() instead of .includes()
        const protos = node.__proto ?? new Map();
        const matchType = fxCfg('selectors.classMatchesType', true);
        return (matchType && t === s.name) || protos.has(s.name);
    }
    if (s.kind === "id") return node.__id === s.id;
    if (s.kind === "attr") {
        const order = fxCfg('selectors.attrResolution', ["meta", "type", "raw", "child"]);
        const rawBag = fx.val(node);
        const typeName = node.__type || null;
        const typeSurface = (rawBag && typeName && typeof rawBag === "object") ? (rawBag as any)[typeName] : undefined;
        const meta = (node as any).__meta;
        let found: any;

        declare const Deno: any;
        declare const process: any;
        declare const require: any;

        for (const where of order) {
            if (where === "meta" && meta && typeof meta === "object" && s.key in meta) { found = meta[s.key]; break; }
            if (where === "type" && typeSurface && typeof typeSurface === "object" && s.key in typeSurface) { found = (typeSurface as any)[s.key]; break; }
            if (where === "raw" && rawBag && typeof rawBag === "object" && s.key in (rawBag as any)) { found = (rawBag as any)[s.key]; break; }
            if (where === "child" && node.__nodes[s.key]) { found = fx.val(node.__nodes[s.key]); break; }
        }

        const val = String(found ?? "");
        const rhs = s.value;

        switch (s.op) {
            case "=": return val === rhs;
            case "!=": return val !== rhs;
            case "^=": return val.startsWith(rhs);
            case "$=": return val.endsWith(rhs);
            case "*=": return val.includes(rhs);
            default: return false;
        }
    }
    if (s.kind === "can") {
        const inner = s.inner;
        const meta = (node as any).__meta;
        const can = meta?.can as string[] | undefined;
        if (inner.kind === "class") return Array.isArray(can) && can.includes(inner.name);
        return false;
    }
    if (s.kind === "has") {
        if (!fxCfg('selectors.enableHas', false)) return false;
        const inner = s.inner;
        const stack = Object.values(node.__nodes);
        while (stack.length) {
            const c = stack.pop()!;
            if (matchCompound(fx, c, inner)) return true;
            for (const k in c.__nodes) stack.push(c.__nodes[k]);
        }
        return false;
    }
    if (s.kind === "not") return !matchCompound(fx, node, s.inner);
    return false;
}
function matchStep(fx: FXCore, node: FXNode, step: SelStep): boolean {
    return step.simple.every(s => matchSimple(fx, node, s));
}
function findParent(fx: FXCore, n: FXNode) {
    const m = (fx as any).findParentFast?.(n);
    if (m !== undefined) return m;
    const stack = [fx.root];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const k in cur.__nodes) {
            const c = cur.__nodes[k];
            if (c === n) return cur;
            stack.push(c);
        }
    }
    return null;
}
function matchCompound(fx: FXCore, node: FXNode, ast: SelCompound): boolean {
    const parts = ast.chain.filter(Boolean);
    let curNodes: FXNode[] = [node];
    for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part === "desc" || part === "child") continue;
        const step = part as SelStep;
        curNodes = curNodes.filter(n => matchStep(fx, n, step));
        if (!curNodes.length) return false;

        const prev = parts[i - 1];
        if (prev === "child") {
            curNodes = curNodes.map(n => findParent(fx, n)).filter(Boolean) as FXNode[];
            i--;
            if (!curNodes.length) return false;
        } else if (prev === "desc") {
            const ancestors = new Set<FXNode>();
            for (const n of curNodes) {
                let p = findParent(fx, n);
                while (p) { ancestors.add(p); p = findParent(fx, p); }
            }
            curNodes = Array.from(ancestors);
            i--;
            if (!curNodes.length) return false;
        } else {
            break;
        }
    }
    return curNodes.length > 0;
}
// #endregion fx::selector-engine

// #region fx::groups
/////////////////////
// Reactive Groups //
/////////////////////

type GroupMode = "list" | "set";
type GroupListener = (g: Group, payload?: any) => void;

class Group {
    private fx: FXCore;
    private anchor: FXNode;
    private members = new Set<FXNode>();          // current reconciled members
    private perNodeUnwatch = new Map<string, () => void>();

    private mode: GroupMode = "list";
    private deepFlag = false;
    private listeners = new Map<string, Set<GroupListener>>();
    private filterFn: ((p: FXNodeProxy) => boolean) | null = null;
    private typeFilter: string[] | null = null;

    private reactive = fxCfg('groups.reactiveDefault', true);
    private debounceMs = fxCfg('groups.debounceMs', 20);
    private offStructure?: () => void;

    // CSS composition
    private includeSelectors: SelList[] = [];
    private excludeSelectors: SelList[] = [];

    // Ordered manual set
    private manualOrder: string[] = [];
    private manualSet = new Set<string>();

    constructor(fx: FXCore, anchor: FXNode) {
        this.fx = fx; this.anchor = anchor;
    }

    // type guards
    private isPredicate(x: any): x is (p: FXNodeProxy) => boolean {
        // FXNodeProxy is also a function; it has a .node() method. A user predicate won't.
        return typeof x === "function" && typeof (x as any).node !== "function";
    }

    // ---------- selection & filters ----------
    byType(...types: string[]) { this.typeFilter = types.filter(Boolean); this.reconcile(); return this; }
    where(fn: (p: FXNodeProxy) => boolean) { this.filterFn = fn; this.reconcile(); return this; }
    deep(flag = true) { this.deepFlag = flag; this.reconcile(); return this; }
    modeSet() { this.mode = "set"; return this; }
    modeList() { this.mode = "list"; return this; }

    reactiveMode(flag = true) { this.reactive = flag; if (flag) this.hook(); else this.unhook(); return this; }
    debounce(ms: number) { this.debounceMs = ms; return this; }

    selectCss(selector: string) { this.includeSelectors.push(parseSelector(selector)); this.reconcile(); return this; }
    excludeCss(selector: string) { this.excludeSelectors.push(parseSelector(selector)); this.reconcile(); return this; }
    removeSelector(selector: string) {
        const ast = JSON.stringify(parseSelector(selector));
        this.includeSelectors = this.includeSelectors.filter(s => JSON.stringify(s) !== ast);
        this.excludeSelectors = this.excludeSelectors.filter(s => JSON.stringify(s) !== ast);
        this.reconcile(); return this;
    }
    clearSelectors(kind: "include" | "exclude" | "all" = "all") {
        if (kind === "include" || kind === "all") this.includeSelectors = [];
        if (kind === "exclude" || kind === "all") this.excludeSelectors = [];
        this.reconcile(); return this;
    }

    // ---------- manual ordered membership ----------
    addPath(path: string) { const n = this.fx.resolvePath(path, this.fx.root); if (n) this.add(n); return this; }
    private idOf(n: FXNode) { return n.__id; }
    private resolveTarget(t: string | FXNodeProxy | FXNode): FXNode | null {
        if (!t) return null;
        if (typeof t === "string") return this.fx.resolvePath(t, this.fx.root) || null;
        if (typeof t === "function" && typeof (t as any).node === "function") return (t as any).node();
        const n = t as FXNode;
        return n?.__id ? n : null;
    }

    add(target: string | FXNodeProxy | FXNode) {
        const n = this.resolveTarget(target); if (!n) return this;
        const id = this.idOf(n);
        if (!this.manualSet.has(id)) {
            this.manualSet.add(id);
            this.manualOrder.push(id);
            // Add to members immediately for manual additions
            if (!this.members.has(n)) {
                this.members.add(n);
                const un = this.fx.createNodeProxy(n).watch((_nv: any) => this.emit("change"));
                this.perNodeUnwatch.set(n.__id, un);
            }
            this.emit("change");
        }
        return this;
    }
    prepend(target: string | FXNodeProxy | FXNode) {
        const n = this.resolveTarget(target); if (!n) return this;
        const id = this.idOf(n);
        if (!this.manualSet.has(id)) { this.manualSet.add(id); this.manualOrder.unshift(id); this.emit("change"); }
        return this;
    }
    insert(index: number, target: string | FXNodeProxy | FXNode) {
        const n = this.resolveTarget(target); if (!n) return this;
        const id = this.idOf(n);
        if (!this.manualSet.has(id)) {
            this.manualSet.add(id);
            const i = Math.max(0, Math.min(index, this.manualOrder.length));
            this.manualOrder.splice(i, 0, id);
            this.emit("change");
        }
        return this;
    }
    addAfter(existing: string | FXNodeProxy | FXNode, target: string | FXNodeProxy | FXNode, opts?: { occurrence?: number }) {
        const ex = this.resolveTarget(existing); const add = this.resolveTarget(target);
        if (!ex || !add) return this;
        const exId = this.idOf(ex), addId = this.idOf(add);
        let occ = opts?.occurrence ?? 1, pos = -1;
        for (let i = 0; i < this.manualOrder.length; i++) {
            if (this.manualOrder[i] === exId && --occ === 0) { pos = i; break; }
        }
        if (pos === -1) return this.add(add);
        if (!this.manualSet.has(addId)) {
            this.manualSet.add(addId);
            this.manualOrder.splice(pos + 1, 0, addId);
            this.emit("change");
        }
        return this;
    }
    addBefore(existing: string | FXNodeProxy | FXNode, target: string | FXNodeProxy | FXNode) {
        const ex = this.resolveTarget(existing); const add = this.resolveTarget(target);
        if (!ex || !add) return this;
        const exId = this.idOf(ex), addId = this.idOf(add);
        const pos = this.manualOrder.indexOf(exId);
        if (pos < 0) return this.prepend(add);
        if (!this.manualSet.has(addId)) {
            this.manualSet.add(addId);
            this.manualOrder.splice(pos, 0, addId);
            this.emit("change");
        }
        return this;
    }
    remove(target: string | FXNodeProxy | FXNode | ((p: FXNodeProxy) => boolean)) {
        if (this.isPredicate(target)) {
            for (let i = this.manualOrder.length - 1; i >= 0; i--) {
                const id = this.manualOrder[i];
                const node = this.findById(id);
                if (node && target(this.fx.createNodeProxy(node))) {
                    this.manualOrder.splice(i, 1); this.manualSet.delete(id);
                }
            }
            this.emit("change");
            return this;
        }
        const n = this.resolveTarget(target); if (!n) return this;
        const id = this.idOf(n);
        if (this.manualSet.has(id)) {
            this.manualSet.delete(id);
            const idx = this.manualOrder.indexOf(id);
            if (idx >= 0) this.manualOrder.splice(idx, 1);
            this.emit("change");
        }
        return this;
    }
    clear() { this.manualOrder.length = 0; this.manualSet.clear(); this.emit("change"); return this; }
    private findById(id: string): FXNode | null {
        const stack = [this.fx.root];
        while (stack.length) {
            const n = stack.pop()!;
            if (n.__id === id) return n;
            for (const k in n.__nodes) stack.push(n.__nodes[k]);
        }
        return null;
    }

    // ---------- materialization & reconcile ----------
    private collectBySelectors(lists: SelList[]): FXNode[] {
        if (!lists.length) return [];
        const res: FXNode[] = [];
        const visit = (n: FXNode) => {
            for (const k in n.__nodes) {
                const c = n.__nodes[k];
                const ok = lists.some(list => list.some(comp => matchCompound(this.fx, c, comp)));
                if (ok) res.push(c);
                // Always traverse deep when using CSS selectors
                visit(c);
            }
        };
        visit(this.anchor);
        return res;
    }

    private materialize(): FXNode[] {
        // 1) manual list in order
        const out: FXNode[] = [];
        const seen = new Set<string>();
        for (const id of this.manualOrder) {
            const n = this.findById(id); if (!n) continue;
            out.push(n); seen.add(id);
        }
        // 2) includes
        const inc = this.collectBySelectors(this.includeSelectors);
        for (const n of inc) {
            const id = this.idOf(n);
            if (!seen.has(id)) { out.push(n); seen.add(id); }
        }
        // 3) excludes
        const exc = new Set(this.collectBySelectors(this.excludeSelectors).map(n => this.idOf(n)));
        const filtered = out.filter(n => !exc.has(this.idOf(n)));
        return filtered;
    }

    private scanFallback(): FXNode[] {
        const res: FXNode[] = [];
        const visit = (n: FXNode) => {
            for (const k in n.__nodes) {
                const c = n.__nodes[k];
                let ok = true;
                if (this.typeFilter && this.typeFilter.length) ok = !!c.__type && this.typeFilter.includes(c.__type);
                if (ok && this.filterFn) ok = this.filterFn(this.fx.createNodeProxy(c));
                if (ok) res.push(c);
                if (this.deepFlag) visit(c);
            }
        };
        visit(this.anchor);
        return res;
    }

    private scanOnce() {
        const haveCss = this.includeSelectors.length || this.excludeSelectors.length;
        return haveCss ? this.materialize() : this.scanFallback();
    }

    private resubscribe() {
        for (const un of this.perNodeUnwatch.values()) try { un(); } catch { }
        this.perNodeUnwatch.clear();
        for (const n of this.members) {
            const un = this.fx.createNodeProxy(n).watch((_nv: any) => this.emit("change"));
            this.perNodeUnwatch.set(n.__id, un);
        }
    }

    private reconcile() {
        const next = new Set(this.scanOnce());
        let changed = false;

        for (const n of Array.from(this.members)) {
            if (!next.has(n)) { this.members.delete(n); changed = true; const un = this.perNodeUnwatch.get(n.__id); if (un) { un(); this.perNodeUnwatch.delete(n.__id); } }
        }
        for (const n of next) {
            if (!this.members.has(n)) { this.members.add(n); changed = true; const un = this.fx.createNodeProxy(n).watch((_nv: any) => this.emit("change")); this.perNodeUnwatch.set(n.__id, un); }
        }
        if (changed) this.emit("change");
    }

    initSelection() { this.reconcile(); if (this.reactive) this.hook(); return this; }

    private isInSubtree(n: FXNode, root: FXNode) {
        if (n === root) return true;
        let p = findParent(this.fx, n);
        while (p) { if (p === root) return true; p = findParent(this.fx, p); }
        return false;
    }

    private hook() {
        if (this.offStructure) return;
        let pending = false, timer: any = null;
        const flush = () => { pending = false; timer = null; this.reconcile(); };
        const schedule = () => {
            console.log("Sheduling");
            if (pending) return;
            pending = true;
            if (this.debounceMs <= 0) flush();
            else timer = setTimeout(flush, this.debounceMs);
        };

        this.offStructure = this.fx.onStructure((e) => {
            if (!this.isInSubtree(e.node, this.anchor)) return;
            schedule();
        });
        this.reconcile();
    }

    private unhook() {
        if (this.offStructure) { try { this.offStructure(); } catch { } this.offStructure = undefined; }
        for (const un of this.perNodeUnwatch.values()) try { un(); } catch { }
        this.perNodeUnwatch.clear();
    }

    // ---------- public read ops ----------
    list(): FXNodeProxy[] {
        const arr = Array.from(this.members).map(n => this.fx.createNodeProxy(n));
        return this.mode === "list" ? arr : Array.from(new Set(arr));
    }
    private values() { return this.list().map(p => p.val()); }
    sum() { return this.values().reduce((a: any, b: any) => Number(a) + Number(b), 0); }
    concat(sep = "") { return this.values().join(sep); }
    // overloads ensure correct return typing
    cast(kind: "number"): number[];
    cast(kind: "string"): string[];
    cast(kind: "boolean"): boolean[];
    cast(kind: "number" | "string" | "boolean") { const v = this.values(); if (kind === "number") return v.map(Number); if (kind === "boolean") return v.map(Boolean); return v.map(String); }
    max() { return Math.max(...(this.cast("number") as number[])); }
    min() { return Math.min(...(this.cast("number") as number[])); }
    average() { const a = this.cast("number") as number[]; return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN; }
    sort(dir: "asc" | "desc" = "asc") { const v = [...this.values()].sort((a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0)); return dir === "asc" ? v : v.reverse(); }
    same(kind: "value" | "type" = "value") {
        const arr = this.list();
        if (!arr.length) return true;
        if (kind === "type") { const t = arr[0].type(); return arr.every(n => n.type() === t); }
        const v = arr[0].val(); return arr.every(n => n.val() === v);
    }
    has(v: any) { return this.values().some(x => x === v); }

    // events
    on(ev: string, handler: GroupListener | any) {
        if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
        const wrap: GroupListener =
            typeof handler === "function"
                ? handler
                : (g: Group) => {
                    if (ev === "has" && handler?.value !== undefined) {
                        if (g.has(handler.value)) handler.callback?.(g);
                    } else if (ev === "average") {
                        const avg = g.average();
                        if ((handler.equalTo !== undefined && avg === handler.equalTo)
                            || (handler.greaterThan !== undefined && avg > handler.greaterThan)
                            || (handler.lessThan !== undefined && avg < handler.lessThan)) {
                            handler.callback?.(g, avg);
                        }
                    } else {
                        handler?.callback?.(g);
                    }
                };
        this.listeners.get(ev)!.add(wrap);
        return () => this.off(ev, wrap);
    }
    off(ev: string, handler: GroupListener) { this.listeners.get(ev)?.delete(handler); }
    emit(ev: string) { const ls = this.listeners.get(ev); if (!ls) return; for (const h of Array.from(ls)) try { h(this); } catch (e) { console.error(e); } }
}

function wrapGroup(g: Group) {
    return {
        // membership (paths or proxies)
        add: (t: any) => { g.add(t); return wrapGroup(g); },
        insert: (i: number, t: any) => { g.insert(i, t); return wrapGroup(g); },
        addAfter: (ex: any, t: any, o?: { occurrence?: number }) => { g.addAfter(ex, t, o); return wrapGroup(g); },
        addBefore: (ex: any, t: any) => { g.addBefore(ex, t); return wrapGroup(g); },
        prepend: (t: any) => { g.prepend(t); return wrapGroup(g); },
        remove: (t: any) => { g.remove(t); return wrapGroup(g); },
        clear: () => { g.clear(); return wrapGroup(g); },

        // composition (CSS)
        select: (cssOrType?: string | string[]) => {
            if (typeof cssOrType === "string" && /[#\.\[:]/.test(cssOrType)) g.selectCss(cssOrType);
            else if (cssOrType) g.byType(...(Array.isArray(cssOrType) ? cssOrType : [cssOrType]));
            return wrapGroup(g.initSelection());
        },
        include: (css: string) => { g.selectCss(css); g.initSelection(); return wrapGroup(g); },
        exclude: (css: string) => { g.excludeCss(css); return wrapGroup(g); },
        removeSelector: (css: string) => { g.removeSelector(css); return wrapGroup(g); },
        clearSelectors: (kind?: "include" | "exclude" | "all") => { g.clearSelectors(kind); return wrapGroup(g); },

        // config
        options: (o: { mode?: "set" | "list" }) => { if (o.mode === "set") g.modeSet(); else if (o.mode === "list") g.modeList(); return wrapGroup(g); },
        deep: (flag = true) => { g.deep(flag); return wrapGroup(g); },
        where: (fn: (p: FXNodeProxy) => boolean) => { g.where(fn); return wrapGroup(g); },
        reactive: (flag = true) => { g.reactiveMode(flag); return wrapGroup(g); },
        debounce: (ms: number) => { g.debounce(ms); return wrapGroup(g); },
        name: (_n: string) => wrapGroup(g),

        // events
        on: (ev: string, h: any) => g.on(ev, h),
        off: (ev: string, h: any) => g.off(ev, h),

        // access & ops
        list: () => g.list(),
        sum: () => g.sum(),
        concat: (sep?: string) => g.concat(sep),
        cast: (k: "number" | "string" | "boolean") => g.cast(k as any),
        max: () => g.max(),
        min: () => g.min(),
        average: () => g.average(),
        sort: (dir?: "asc" | "desc") => g.sort(dir),
        same: (kind?: "value" | "type") => g.same(kind ?? "value"),
        hasValue: (v: any) => g.has(v),

        _group: g,
    };
}
// #endregion fx::groups

// #region fx::bootstrap
/////////////////////////////
// Globals & Bootstrapping //
/////////////////////////////

fx = new FXCore();
const $_$$ = fx.createNodeProxy(fx.root);
fx.ensureSystemRoots();

// expose early config defaults
// (already set in constructor via installDefaults)

let $$: FXNodeProxy = $_$$("app");
const $root = (p: string) => { $$ = $_$$(p); (globalThis as any).$$ = $$; };
const $val = (path: string, value?: any, def?: any) => { const r = $$(path).val(); if (value !== undefined) { $$(path).val(value); return $$(path); } return r === undefined ? def : r; };
const $set = (path: string, value: any) => $$(path).set(value);
const $get = (path: string) => $$(path).get();
const $has = (path: string) => $$(path).val() !== undefined;

// convenience globals
const $app = $_$$('app');
const $config = $_$$('config');
const $plugins = $_$$('plugins');
const $modules = $_$$('modules');
const $atomics = $_$$('atomics');
const $dom = $_$$('dom');
const $session = $_$$('session');
const $system = $_$$('system');
const $cache = $_$$('cache');

Object.assign(globalThis as any, { fx, $_$$, $$, $root, $val, $set, $get, $has, $app, $config, $plugins, $modules, $atomics, $dom, $session, $system, $cache });

// Enable @-syntax (module loading + API shortcuts)
$$ = patchDollarAtSyntax(fx);
// keep global in sync after patching $$
(globalThis as any).$$ = $$;

// Export all globals for module usage
export { fx, $_$$, $$, $root, $val, $set, $get, $has, $app, $config, $plugins, $modules, $atomics, $dom, $session, $system, $cache, patchDollarAtSyntax, invokeWithSuspendReplay };
// #endregion fx::bootstrap

// #region fx::deno-server
///////////////////////
// Optional Deno srv //
///////////////////////

// Only start server if FX_SERVE environment variable is set or this is the main module
if (IS_SERVER && (globalThis as any).Deno?.serve && ((globalThis as any).Deno.env.get("FX_SERVE") === "true" || import.meta.main)) {
    const PORT = Number((globalThis as any).Deno.env.get("PORT") || "8787");

    (globalThis as any).Deno.serve({ port: PORT }, async (req: Request) => {
        const url = new URL(req.url);
        const path = url.pathname;

        if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
        if (path === "/fx/health") return cors(json({ ok: true, time: new Date().toISOString() }));

        // Log endpoint for flow demo
        if (path === "/fx/log") {
            const logFile = "./flow-log.txt";

            if (req.method === "POST") {
                // Append to log file
                try {
                    const body = await req.json();
                    const value = body.value || "";
                    await (globalThis as any).Deno.writeTextFile(logFile, String(value), { append: true });
                    return cors(json({ ok: true, logged: value }));
                } catch (e: any) {
                    return cors(json({ error: String(e?.message || e) }, 500));
                }
            } else if (req.method === "GET") {
                // Read log file
                try {
                    const content = await (globalThis as any).Deno.readTextFile(logFile);
                    return cors(json({ log: content }));
                } catch (e: any) {
                    // File doesn't exist yet
                    return cors(json({ log: "" }));
                }
            } else if (req.method === "DELETE") {
                // Clear log file
                try {
                    await (globalThis as any).Deno.writeTextFile(logFile, "");
                    return cors(json({ ok: true, cleared: true }));
                } catch (e: any) {
                    return cors(json({ error: String(e?.message || e) }, 500));
                }
            }
        }

        // Flow execution endpoint
        if (path === "/fx/flow") {
            if (req.method === "POST") {
                try {
                    const body = await req.json();
                    const { flow, node, payload } = body;
                    const $flow = (globalThis as any).$flow;
                    if (!$flow) return cors(json({ error: "fx-flow not loaded" }, 500));
                    const flowInstance = $flow(flow);
                    const result = flowInstance.start(node, payload || {});
                    return cors(json({ ok: true, result: result.data }));
                } catch (e: any) {
                    return cors(json({ error: String(e?.message || e) }, 500));
                }
            }
        }

        if (path === "/fx/proxy") {
            const target = url.searchParams.get("url");
            if (!target) return cors(json({ error: "Missing url" }, 400));
            try {
                const body = await maybeBody(req);
                const headers = new Headers(req.headers);
                headers.delete("host"); headers.delete("origin"); headers.delete("referer");
                const r = await fetch(target, { method: req.method, headers, body: body?.raw });
                const h = new Headers(r.headers);
                h.set("content-type", r.headers.get("content-type") || "application/octet-stream");
                return cors(new Response(await r.arrayBuffer(), { status: r.status, headers: h }));
            } catch (e: any) {
                return cors(json({ error: String(e?.message || e) }, 500));
            }
        }

        // Dynamic bundle endpoint: serve a JS bundle of fx.ts for the browser
        if (path === "/fx/module") {
            try {
                const entry = url.searchParams.get("entry") || "./fx.ts";
                // Use Deno.emit to bundle TypeScript into a single JS file
                // deno-lint-ignore no-explicit-any
                const denoAny: any = (globalThis as any).Deno;
                const baseUrl: any = (import.meta as any).url;
                const { files } = await denoAny.emit(new URL(entry, baseUrl), { bundle: "classic" });
                const js = files["deno:///bundle.js"] || files[Object.keys(files)[0]] || "";
                const h = new Headers({ "content-type": "application/javascript; charset=utf-8" });
                return cors(new Response(js, { status: 200, headers: h }));
            } catch (e: any) {
                return cors(json({ error: "emit-fail", message: String(e?.message || e) }, 500));
            }
        }

        // Static file server for UI: serve files from the directory of this fx.ts
        try {
            const base = (import.meta as any).url.replace(/[^\/]+$/, "");
            const rel = path === "/" ? "index.html" : path.replace(/^\//, "");

            // Security: prevent directory traversal
            if (rel.includes("..")) {
                return cors(json({ error: "Invalid path" }, 400));
            }

            const fileUrl = new URL(rel, base);
            const ext = rel.split(".").pop()?.toLowerCase() || "";

            // TypeScript files: serve with JS MIME type (browsers with import maps can handle it)
            // For full transpilation, use external build tools (esbuild, etc.)
            if (ext === "ts" || ext === "tsx") {
                try {
                    // deno-lint-ignore no-explicit-any
                    const data = await ((globalThis as any).Deno as any).readFile(fileUrl);
                    // Serve as JavaScript - modern browsers can handle TS with proper setup
                    return cors(new Response(data, {
                        status: 200,
                        headers: new Headers({
                            "content-type": "application/javascript; charset=utf-8",
                            "x-typescript-types": fileUrl.toString()
                        })
                    }));
                } catch (e: any) {
                    return cors(json({ error: "file-error", message: String(e?.message || e) }, 500));
                }
            }

            // Regular files
            // deno-lint-ignore no-explicit-any
            const data = await ((globalThis as any).Deno as any).readFile(fileUrl);
            const type = (
                {
                    "html": "text/html; charset=utf-8",
                    "htm": "text/html; charset=utf-8",
                    "js": "application/javascript; charset=utf-8",
                    "jsx": "application/javascript; charset=utf-8",
                    "css": "text/css; charset=utf-8",
                    "json": "application/json; charset=utf-8",
                    "png": "image/png",
                    "jpg": "image/jpeg",
                    "jpeg": "image/jpeg",
                    "svg": "image/svg+xml",
                    "gif": "image/gif",
                    "ico": "image/x-icon",
                    "woff": "font/woff",
                    "woff2": "font/woff2",
                    "ttf": "font/ttf",
                    "txt": "text/plain; charset=utf-8"
                } as Record<string, string>
            )[ext] || "application/octet-stream";
            return cors(new Response(data, { status: 200, headers: new Headers({ "content-type": type }) }));
        } catch (_) {
            return cors(json({ error: "not-found" }, 404));
        }

        return cors(json({
            fx: "online",
            endpoints: { health: "/fx/health", proxy: "/fx/proxy?url=<encoded>", module: "/fx/module?url=<encoded>" }
        }));
    });

    console.log(`[FX] Deno server listening on http://localhost:${(globalThis as any).Deno.env.get("PORT") || 8787}`);
}

async function maybeBody(req: Request) {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/json")) { const j = await req.json().catch(() => undefined); return { raw: JSON.stringify(j ?? {}) }; }
    if (ct.includes("text/")) { const t = await req.text(); return { raw: t }; }
    if (ct.includes("form")) {
        const form = await req.formData();
        const data = new URLSearchParams(); for (const [k, v] of (form as any).entries()) data.append(k, String(v));
        return { raw: data.toString() };
    }
    try { const b = await req.arrayBuffer(); return { raw: b }; } catch { return undefined; }
}
function json(obj: any, status = 200) { return new Response(JSON.stringify(obj), { status, headers: new Headers({ "content-type": "application/json; charset=utf-8" }) }); }
function cors(res: Response) {
    const h = new Headers(res.headers);
    h.set("access-control-allow-origin", "*");
    h.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    h.set("access-control-allow-headers", "Content-Type,Authorization,Accept");
    return new Response(res.body, { status: res.status, headers: h });
}
// #endregion fx::deno-server

// #region fx::global-decl
export default fx;

/**
 * Quick refs:
 *
 * // Leading-@ → sync module default
 * const User = $$("@/plugins/User.ts");
 * const u = new User("Charl", "Cronje");
 *
 * // path@spec → attach
 * $$("app.user@/plugins/User.ts").options({ type: "user", instantiateDefault: { args: ["Charl","Cronje"] }, global: "$user" });
 * const u2 = $$("app.user").as("User");
 *
 * // API shortcuts
 * $$("data@/api/users").get({ headers: { accept: "application/json" }, global: "$users" });
 *
 * // CSS groups
 * const actives = $$("app.users").select('.user[active=true]').on('change', () => console.log('changed'));
 * const team = $$("teams.core").group([]).include('.user').exclude('.banned').add($$("people.alice")).addAfter($$("people.alice"), $$("people.bob"));
 */

// TypeScript global declarations
declare global {
    var fx: FXCore;
    var $$: FXNodeProxy;
    var $_$$: (path: string) => FXNodeProxy;
    var $root: (p: string) => FXNodeProxy;
    var $val: (path: string, value?: any, def?: any) => any;
    var $set: (path: string, value: any) => void;
    var $get: (path: string) => any;
    var $has: (path: string) => boolean;
    var $app: FXNodeProxy;
    var $config: FXNodeProxy;
    var $plugins: FXNodeProxy;
    var $modules: FXNodeProxy;
    var $atomics: FXNodeProxy;
    var $dom: FXNodeProxy;
    var $session: FXNodeProxy;
    var $system: FXNodeProxy;
    var $cache: FXNodeProxy;

    // Plugins
    var $serialize: FXNodeProxy;
    var $flow: FXNodeProxy;
    var $hono: FXNodeProxy;
    var $: FXNodeProxy;
    var $api: FXNodeProxy;
    var $scout: FXNodeProxy;
    var $dev: FXNodeProxy;
    var $visualizer: FXNodeProxy;
    var $cache: FXNodeProxy;
    var $safe: FXNodeProxy;
    var $router: FXNodeProxy;
    var $react: FXNodeProxy;
    var $jsx: FXNodeProxy;
    var $components: FXNodeProxy;
    var $pages: FXNodeProxy;
    var $time: FXNodeProxy;
    var $atomics: FXNodeProxy;
    var $reality: FXNodeProxy;
    var $fs: FXNodeProxy;
    var $markdown: FXNodeProxy;
}
// #endregion fx::global-decl
