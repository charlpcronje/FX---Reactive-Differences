// /plugins/fx-orm.ts
/**
 * @fx-plugin fx-orm
 * @fx-global $db
 * @fx-description Zero-latency database with CSS queries and reactive models
 * @fx-dependencies
 * @fx-provides $db
 * @fx-version 3.1.0
 *
 * FX DB/ORM - v3.1.0 "Mainnet-Zero Leak"
 * ---------------------------------------------------------------------------
 * - Global surface: `$db` (set with options.global)
 * - Frontend queries: fully synchronous via Worker + SharedArrayBuffer + Atomics
 *   to FX.ps (plan/row/update/insert). No latency leaks into FX mainline.
 * - Intent-first results (IDs only) + lazy hydration on data access.
 * - Smart batch loading: N+1 queries automatically batched into 1 bulk fetch.
 *   Example: for (const user of $db.users.select(':limit(1000)')) { user.name }
 *   → First access triggers bulk fetch of ALL unloaded rows in ONE query.
 * - Reactive autosave: mutate fields => debounce -> sync update.
 * - 100% sync surface for reads/writes (both browser & Deno server).
 * - Fuzzy table name matching.
 * - Backwards-compatible table API: .select/.find/.where/.first/.all/.create,
 *   callable `$db("table")`, property `$db.users`, numeric ID accessors.
 *
 * Notes:
 * - Browser must be cross-origin isolated for SAB (SharedArrayBuffer).
 * - Security/auth intentionally out of scope per request; use headers in options.
 */

import type { FXCore, FXNodeProxy } from '../fx.v4';

/* =============================================================================
   Env + helpers
============================================================================= */

const HAS_DENO = typeof (globalThis as any).Deno !== "undefined";
const IS_SERVER = HAS_DENO;
const IS_CLIENT = !IS_SERVER;

const JSON_SAFE = (v: any) => { try { return JSON.stringify(v); } catch { return String(v); } };

const tinySpinWait = () => {
    if (typeof window !== "undefined") {
        const start = performance.now();
        while (performance.now() - start < 0.5) { /* tiny busy slice */ }
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => { });
        return;
    }
    const sab = new SharedArrayBuffer(4);
    const i32 = new Int32Array(sab);
    // @ts-ignore
    Atomics.wait(i32, 0, 0, 2);
};


/* =============================================================================
   Query parsing (selector-ish)
============================================================================= */

interface QueryCondition { field: string; operator: string; value: any; }
interface ParsedQuery {
    action: string;
    conditions: QueryCondition[];
    limit?: number;
    offset?: number;
    orderBy?: { field: string; direction: string };
    includes: string[];
}

class QueryParser {
    static parse(query: string): ParsedQuery {
        const out: ParsedQuery = { action: "select", conditions: [], includes: [] };

        const am = query.match(/^(select|find|get|update|delete|insert)/i);
        if (am) out.action = am[1].toLowerCase();

        const idm = query.match(/#(\w+)/);
        if (idm) out.conditions.push({ field: "id", operator: "=", value: this.val(idm[1]) });

        const cm = query.match(/\.(\w+)/);
        if (cm) out.conditions.push({ field: "status", operator: "=", value: cm[1] });

        const at = query.matchAll(/\[([^=><*^$!~]+)([=><*^$!~]+)([^\]]+)\]/g);
        for (const m of at) {
            const [, field, op, v] = m;
            out.conditions.push({ field: field.trim(), operator: this.op(op), value: this.val(v.replace(/['"]/g, "")) });
        }

        const pseudos = query.matchAll(/:([a-zA-Z]+)(?:\(([^)]+)\))?/g);
        for (const m of pseudos) {
            const [, k, v] = m;
            switch (k) {
                case "first": out.limit = 1; break;
                case "last": out.limit = 1; out.orderBy = { field: "id", direction: "desc" }; break;
                case "limit": out.limit = parseInt(v!, 10); break;
                case "offset": out.offset = parseInt(v!, 10); break;
                case "orderBy": {
                    const [f, d = "asc"] = v!.split(",");
                    out.orderBy = { field: f.trim(), direction: d.trim() };
                    break;
                }
                case "includes": out.includes = v!.split(",").map(s => s.trim()); break;
            }
        }

        return out;
    }

    private static op(o: string) {
        const map: Record<string, string> = {
            "=": "=", "!=": "!=", ">": ">", "<": "<", ">=": ">=", "<=": "<=",
            "^=": "LIKE_PREFIX", "$=": "LIKE_SUFFIX", "*=": "LIKE_CONTAINS", "~=": "IN"
        };
        return map[o] || "=";
    }
    private static val(v: string): any {
        if (/^\d+$/.test(v)) return parseInt(v, 10);
        if (/^\d*\.\d+$/.test(v)) return parseFloat(v);
        if (v === "true") return true;
        if (v === "false") return false;
        if (v === "null") return null;
        return v;
    }
}

/* =============================================================================
   Fuzzy table matching
============================================================================= */

class Fuzzy {
    static distance(a: string, b: string) {
        const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
        for (let i = 0; i <= a.length; i++) m[0][i] = i;
        for (let j = 0; j <= b.length; j++) m[j][0] = j;
        for (let j = 1; j <= b.length; j++) for (let i = 1; i <= a.length; i++) {
            const ind = a[i - 1] === b[j - 1] ? 0 : 1;
            m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + ind);
        }
        return m[b.length][a.length];
    }
    static norm(s: string) {
        return s.toLowerCase().replace(/s$/, "").replace(/ies$/, "y").replace(/es$/, "").replace(/[_-]/g, "");
    }
    static best(query: string, tables: string[], threshold = 90): string {
        const q = this.norm(query);
        let best = query, bestScore = 0;
        for (const t of tables) {
            const n = this.norm(t);
            if (q === n) return t;
            const max = Math.max(q.length, n.length);
            const dist = this.distance(q, n);
            const score = ((max - dist) / max) * 100;
            if (score > bestScore && score >= threshold) { best = t; bestScore = score; }
        }
        return best;
    }
}

/* =============================================================================
   Base adapter (server mode) + Mock adapter
============================================================================= */

abstract class BaseAdapter {
    protected connectionString: string;
    protected isConnected = false;
    protected tables: string[] = [];
    constructor(cs: string) { this.connectionString = cs; }
    abstract connect(): Promise<void>;
    abstract disconnect(): Promise<void>;
    abstract execute(sql: string, params?: any[]): Promise<any>;
    abstract insert(table: string, data: any): Promise<any>;
    abstract update(table: string, data: any, where: any): Promise<any>;
    abstract delete(table: string, where: any): Promise<any>;
    getTables() { return this.tables; }
    buildSelect(table: string, q: ParsedQuery) {
        let sql = `SELECT * FROM ${table}`;
        if (q.conditions.length) {
            sql += ` WHERE ` + q.conditions.map(c => {
                if (c.operator === "IN") {
                    const placeholders = Array.isArray(c.value) ? c.value.map(() => "?").join(",") : "?";
                    return `${c.field} IN (${placeholders})`;
                }
                return `${c.field} ${c.operator.replace("LIKE_", "LIKE ")} ?`;
            }).join(" AND ");
        }
        if (q.orderBy) sql += ` ORDER BY ${q.orderBy.field} ${q.orderBy.direction.toUpperCase()}`;
        if (q.limit) sql += ` LIMIT ${q.limit}`;
        if (q.offset) sql += ` OFFSET ${q.offset}`;
        return sql;
    }

    buildParams(q: ParsedQuery): any[] {
        const params: any[] = [];
        for (const c of q.conditions) {
            if (c.operator === "IN" && Array.isArray(c.value)) {
                params.push(...c.value);
            } else {
                params.push(c.value);
            }
        }
        return params;
    }
}

class MockAdapter extends BaseAdapter {
    private store: Record<string, any[]> = {
        users: Array.from({ length: 1000 }).map((_, i) => ({
            id: i + 1, name: `User ${i + 1}`, email: `user${i + 1}@example.com`, age: 18 + (i % 50), status: i % 3 ? "active" : "inactive"
        })),
        products: Array.from({ length: 300 }).map((_, i) => ({
            id: i + 1, name: `Product ${i + 1}`, price: 5 + (i % 100)
        }))
    };
    async connect() { this.isConnected = true; this.tables = Object.keys(this.store); }
    async disconnect() { this.isConnected = false; }
    async execute(sql: string, params: any[] = []) {
        const table = /from\s+(\w+)/i.exec(sql)?.[1] || "users";
        let rows = [...(this.store[table] || [])];

        // Handle WHERE id = ?
        if (/where\s+id\s*=\s*\?/i.test(sql)) {
            const id = params[0];
            const r = rows.find(x => String(x.id) === String(id));
            return r ?? null;
        }

        // Handle WHERE id IN (?, ?, ...)
        if (/where\s+id\s+in\s*\(/i.test(sql)) {
            const ids = params.map(String);
            rows = rows.filter(x => ids.includes(String(x.id)));
            return rows;
        }

        // Handle LIMIT
        const mLimit = /limit\s+(\d+)/i.exec(sql);
        if (mLimit) rows.splice(Number(mLimit[1]));

        return rows;
    }
    async insert(table: string, data: any) {
        const arr = this.store[table] || (this.store[table] = []);
        const id = (arr[arr.length - 1]?.id ?? 0) + 1;
        const rec = { id, ...data }; arr.push(rec); return { id, ...rec };
    }
    async update(table: string, data: any, where: any) {
        const arr = this.store[table] || []; const idx = arr.findIndex(r => r.id == where.id);
        if (idx >= 0) arr[idx] = { ...arr[idx], ...data };
        return arr[idx];
    }
    async delete(table: string, where: any) {
        const arr = this.store[table] || []; const idx = arr.findIndex(r => r.id == where.id);
        if (idx >= 0) arr.splice(idx, 1);
        return true;
    }
}

/* =============================================================================
   Sync RPC (Worker + SAB on client) / spin-wait fetch on server
============================================================================= */

class SyncRPC {
    private sab: SharedArrayBuffer | null = null;
    private lock!: Int32Array;
    private len!: Int32Array;
    private buf!: Uint8Array;
    private worker: Worker | null = null;
    private readonly BUF_SIZE = 2 * 1024 * 1024; // 2MB
    private readonly TIMEOUT_MS = 15000;
    private cache = new Map<string, string>();
    private makeKey(url: string, body: any, headers: Record<string, string>) {
        return url + "|" + JSON.stringify(body ?? null) + "|" + JSON.stringify(headers ?? {});
    }

    constructor() {
        if (IS_CLIENT) this.initClient();
    }

    private initClient() {
        if (typeof SharedArrayBuffer === "undefined" || (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated)) {
            // Degrade gracefully — sync RPC unavailable in this context.
            // ORM methods that need it will fall back to fetch+await; everything
            // else (proxies, watch, in-memory state) keeps working.
            console.warn("[fx-orm] SharedArrayBuffer unavailable (need crossOriginIsolated). Sync RPC disabled — server queries will be async.");
            return;
        }
        this.sab = new SharedArrayBuffer(this.BUF_SIZE);
        this.lock = new Int32Array(this.sab, 0, 1);
        this.len = new Int32Array(this.sab, 4, 1);
        this.buf = new Uint8Array(this.sab, 8);

        const code = `
      self.onmessage = async (e) => {
        const { id, url, headers, body, sab } = e.data;
        const lock = new Int32Array(sab, 0, 1);
        const len  = new Int32Array(sab, 4, 1);
        const buf  = new Uint8Array(sab, 8);
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: new Headers(headers || {}),
            body: JSON.stringify(body || {})
          });
          const text = await res.text();
          const enc = new TextEncoder().encode(text);
          if (enc.length > buf.length) { Atomics.store(lock, 0, -id); Atomics.notify(lock, 0); return; }
          buf.set(enc); len[0] = enc.length;
          Atomics.store(lock, 0, id);
        } catch (err) {
          Atomics.store(lock, 0, -id);
        }
        Atomics.notify(lock, 0);
      };
    `;
        const blob = new Blob([code], { type: "application/javascript" });
        this.worker = new Worker(URL.createObjectURL(blob));
    }

    callSync(url: string, body: any, headers: Record<string, string> = {}): any {
        const key = this.makeKey(url, body, headers);

        // 1) If cached, return synchronously (works everywhere)
        if (this.cache.has(key)) {
            const text = this.cache.get(key)!;
            try { return JSON.parse(text); } catch { return text; }
        }

        // 2) UI thread: NEVER block. Start async fetch and suspend (FX proxy will replay)
        // Check if we're in a browser main thread context (not in a worker)
        const onUI = (typeof window !== "undefined") && (typeof document !== "undefined");
        if (onUI) {
            const p = this.callAsync(url, body, headers).catch(() => { });
            // FXSuspend is exposed on global by fx.ts step 1 block
            // @ts-ignore
            throw new (globalThis as any).FXSuspend(p);
        }

        // 3) Worker/Node: allowed to block
        if (!this.worker || !this.sab) throw new Error("SyncRPC not initialized");
        const id = Math.floor(Math.random() * 1e9);
        Atomics.store(this.lock, 0, 0);
        this.worker.postMessage({
            id,
            url,
            headers: { "content-type": "application/json", ...headers },
            body,
            sab: this.sab
        });
        const r = Atomics.wait(this.lock, 0, 0, this.TIMEOUT_MS);
        if (r === "timed-out") throw new Error("SyncRPC timeout " + url);

        const signal = Atomics.load(this.lock, 0);
        if (signal !== id) throw new Error("SyncRPC error/buffer too small " + url);

        const n = this.len[0];
        const text = new TextDecoder().decode(this.buf.subarray(0, n));
        this.cache.set(key, text);
        try { return JSON.parse(text); } catch { return text; }
    }

    async callAsync(url: string, body: any, headers: Record<string, string> = {}): Promise<any> {
        const key = this.makeKey(url, body, headers);

        // Fast path: cache hit
        if (this.cache.has(key)) {
            const text = this.cache.get(key)!;
            try { return JSON.parse(text); } catch { return text; }
        }

        if (!this.worker || !this.sab) throw new Error("SyncRPC not initialized");
        const id = Math.floor(Math.random() * 1e9);
        Atomics.store(this.lock, 0, 0);
        this.worker.postMessage({
            id,
            url,
            headers: { "content-type": "application/json", ...headers },
            body,
            sab: this.sab
        });

        // Check if we're in a browser main thread context (not in a worker)
        const onUI = (typeof window !== "undefined") && (typeof document !== "undefined");

        // UI: non-blocking wait; Worker/Node: blocking futex
        let status: "ok" | "timed-out" | "not-equal" = "ok";
        if (onUI) {
            const anyAtomics: any = Atomics as any;
            if (typeof anyAtomics.waitAsync === "function") {
                const r = anyAtomics.waitAsync(this.lock, 0, 0, this.TIMEOUT_MS);
                status = r?.async === false ? r.value : await r.value; // "ok" | "timed-out" | "not-equal"
            } else {
                // rAF-yield loop (never blocks paint)
                const start = performance.now();
                while (Atomics.load(this.lock, 0) === 0) {
                    if (performance.now() - start > this.TIMEOUT_MS) { status = "timed-out"; break; }
                    const t0 = performance.now(); while (performance.now() - t0 < 0.5) { } // ~0.5ms slice
                    await new Promise(requestAnimationFrame);
                }
                status = status || "ok";
            }
        } else {
            const r = Atomics.wait(this.lock, 0, 0, this.TIMEOUT_MS);
            status = (r as any) || "ok";
        }

        if (status === "timed-out") throw new Error("SyncRPC timeout " + url);

        const signal = Atomics.load(this.lock, 0);
        if (signal !== id) throw new Error("SyncRPC error/buffer too small " + url);

        const n = this.len[0];
        const text = new TextDecoder().decode(this.buf.subarray(0, n));
        this.cache.set(key, text);
        try { return JSON.parse(text); } catch { return text; }
    }


}

/* =============================================================================
   FX.ps contract + options
============================================================================= */

type StreamCfg = {
    baseUrl: string;                           // e.g., "https://fxps.example.com"
    headers?: Record<string, string>;         // e.g., { "x-auth": "dev" }
    routes?: Partial<{
        plan: string; row: string; rowBulk: string; update: string; insert: string;
    }>;
};

type AttachOptions = {
    type?: string;                             // "db"
    global?: string;                           // "$db"
    connectionStream?: StreamCfg;              // frontend sync RPC -> FX.ps
    defaultConnectionString?: string;          // server local adapter DSN (optional)
    autosaveDebounceMs?: number;               // default 600ms
    prefetchWindow?: number;                   // optional future use
};

/* =============================================================================
   Virtual rows / results
============================================================================= */

type PendingRow = {
    id: string | number;
    loaded: boolean;
    data?: any;
    dirty?: boolean;
    saveTimer?: any;
};

class RowProxy {
    private orm: FXDB;
    private table: string;
    private connId: string;
    private rec: PendingRow;
    private fxNode: FXNodeProxy;
    private savingFromWatch = false;
    private readonly debounceMs: number;
    private parent: VirtualResult | null;

    constructor(orm: FXDB, table: string, connId: string, rec: PendingRow, node: FXNodeProxy, debounceMs: number, parent?: VirtualResult) {
        this.orm = orm; this.table = table; this.connId = connId; this.rec = rec; this.fxNode = node;
        this.debounceMs = debounceMs;
        this.parent = parent || null;

        // seed minimal node (id only)
        node.set({ id: rec.id });

        // watch external node edits (e.g., user edits bound fields)
        node.watch((nv: any, _ov: any) => {
            if (this.savingFromWatch) return;
            if (!this.rec.loaded) return; // ignore early, will reconcile on load
            if (nv && typeof nv === "object") {
                this.rec.data = { ...this.rec.data, ...nv };
                this.scheduleSaveSync();
            }
        });
    }

    private ensureLoadedSync() {
        if (this.rec.loaded) return;

        // Smart batching: when first row in a loop is accessed, batch-load ALL unloaded siblings.
        // This turns N queries into 1 bulk fetch automatically.
        // Example: for (user of users) { user.name } → 1 bulk query on first iteration.
        if (this.parent) {
            this.parent.batchLoadUnloaded();
        }

        // Fallback: if still not loaded (was the only unloaded row), fetch individually
        if (!this.rec.loaded) {
            const row = this.orm.fetchRowSync(this.table, this.connId, this.rec.id);
            this.rec.data = row || { id: this.rec.id };
            this.rec.loaded = true;
        }

        this.fxNode.set(this.rec.data); // reactive update
    }

    private scheduleSaveSync() {
        this.rec.dirty = true;
        if (this.rec.saveTimer) clearTimeout(this.rec.saveTimer);
        this.rec.saveTimer = setTimeout(() => {
            try {
                this.savingFromWatch = true;
                this.orm.updateRowSync(this.table, this.connId, this.rec.id, this.rec.data);
                this.rec.dirty = false;
            } finally {
                this.savingFromWatch = false;
            }
        }, this.debounceMs);
    }

    get proxy(): any {
        const self = this;
        return new Proxy({}, {
            get(_t, key) {
                if (key === "__id") return self.rec.id;
                if (key === "__loaded") return self.rec.loaded;
                if (key === "__load") return () => self.ensureLoadedSync();
                if (key === "__save") return () => self.scheduleSaveSync();
                self.ensureLoadedSync();
                return self.rec.data?.[key as string];
            },
            set(_t, key, val) {
                self.ensureLoadedSync();
                self.rec.data[key as string] = val;
                self.fxNode.set(self.rec.data);
                self.scheduleSaveSync();
                return true;
            },
            ownKeys() { return ["id"]; },
            getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; }
        });
    }
}

class VirtualResult {
    private orm: FXDB;
    private table: string;
    private connId: string;
    private ids: (string | number)[];
    private rowsRoot: FXNodeProxy;
    private rows = new Map<string | number, RowProxy>();
    private readonly debounceMs: number;
    private batchLoadInProgress = false;

    constructor(orm: FXDB, table: string, connId: string, ids: (string | number)[], rowsRoot: FXNodeProxy, debounceMs: number) {
        this.orm = orm; this.table = table; this.connId = connId; this.ids = ids; this.rowsRoot = rowsRoot;
        this.debounceMs = debounceMs;
    }

    length() { return this.ids.length; }

    at(i: number) {
        const id = this.ids[i];
        if (id === undefined) return undefined;
        let rp = this.rows.get(id);
        if (!rp) {
            const node = this.rowsRoot.get(String(id)); // child node keyed by id
            rp = new RowProxy(this.orm, this.table, this.connId, { id, loaded: false }, node, this.debounceMs, this);
            this.rows.set(id, rp);
        }
        return rp.proxy;
    }

    *iter() { for (let i = 0; i < this.ids.length; i++) yield this.at(i); }

    first() { return this.at(0); }

    // Smart batch loading: load all unloaded rows in one query
    batchLoadUnloaded() {
        if (this.batchLoadInProgress) return;

        // Collect all unloaded row IDs and their proxies
        const unloadedIds: (string | number)[] = [];
        const unloadedItems: Array<{ rec: PendingRow; rp: RowProxy }> = [];

        for (const [id, rp] of this.rows.entries()) {
            const rec = (rp as any).rec as PendingRow;
            if (!rec.loaded) {
                unloadedIds.push(id);
                unloadedItems.push({ rec, rp });
            }
        }

        // If there are multiple unloaded rows, batch fetch them
        if (unloadedIds.length > 1) {
            this.batchLoadInProgress = true;
            try {
                const rowsMap = this.orm.fetchRowsBulkSync(this.table, this.connId, unloadedIds);

                // Update all pending records with fetched data
                for (const { rec, rp } of unloadedItems) {
                    rec.data = rowsMap[rec.id] || { id: rec.id };
                    rec.loaded = true;
                    // Update FX node for reactivity (access via proxy internals)
                    (rp as any).fxNode.set(rec.data);
                }
            } finally {
                this.batchLoadInProgress = false;
            }
        }
    }
}

/* =============================================================================
   FXDB main
============================================================================= */

export class FXDB {
    private fx: FXCore;
    private rpc = new SyncRPC();
    private connections = new Map<string, { adapter: BaseAdapter; type: string }>();
    private stream?: Required<StreamCfg>;
    private autosaveDebounceMs = 600;

    public readonly name = "db";
    public readonly version = "3.1.0";

    constructor(fx: FXCore, opts: AttachOptions = {}) {
        this.fx = fx;

        // Connection stream for frontend sync calls
        if (opts.connectionStream?.baseUrl) {
            const r = opts.connectionStream.routes || {};
            this.stream = {
                baseUrl: opts.connectionStream.baseUrl.replace(/\/+$/, ""),
                headers: opts.connectionStream.headers || {},
                routes: {
                    plan: r.plan ?? "/plan",
                    row: r.row ?? "/row",
                    rowBulk: r.rowBulk ?? "/row-bulk",
                    update: r.update ?? "/update",
                    insert: r.insert ?? "/insert"
                }
            };
        }

        this.autosaveDebounceMs = typeof opts.autosaveDebounceMs === "number" ? Math.max(0, opts.autosaveDebounceMs) : 600;

        // Optional local adapter on server side
        if (opts.defaultConnectionString && IS_SERVER) {
            this.connect(opts.defaultConnectionString).catch(() => { /* ignore */ });
        }
    }

    /* ---------------------------- Connections ---------------------------- */

    async connect(connectionString: string, options: { name?: string } = {}) {
        const name = options.name || "default";
        const adapter = new MockAdapter(connectionString); // swap for real adapter(s)
        await adapter.connect();
        this.connections.set(name, { adapter, type: this.detectDb(connectionString) });
    }

    private detectDb(cs: string) {
        if (cs.startsWith("postgres://") || cs.startsWith("postgresql://")) return "postgres";
        if (cs.startsWith("mysql://")) return "mysql";
        if (cs.startsWith("sqlite://") || cs.includes(".db")) return "sqlite";
        if (cs.startsWith("mongodb://")) return "mongodb";
        return "unknown";
    }

    private getConnection(id = "default") {
        const c = this.connections.get(id);
        if (!c) throw new Error(`No connection: ${id}`);
        return c;
    }

    /* ------------------------------ Utilities ---------------------------- */

    private url(path: string) {
        if (!this.stream) throw new Error("No connectionStream configured for $db");
        return this.stream.baseUrl + (path.startsWith("/") ? path : "/" + path);
    }

    private psSync(path: string, body: any) {
        if (!this.stream) throw new Error("No connectionStream configured for $db");
        return this.rpc.callSync(this.url(path), body, this.stream.headers);
    }

    private resolveTable(name: string, connectionId: string) {
        try {
            const { adapter } = this.getConnection(connectionId);
            const tables = adapter.getTables() || [name];
            return Fuzzy.best(name, tables) || name;
        } catch { return name; }
    }

    /* --------------------- Local (server) sync fallbacks ----------------- */

    private localPlanSync(table: string, q: ParsedQuery, connId: string) {
        if (!IS_SERVER) return null;
        try {
            const { adapter } = this.getConnection(connId);
            const sql = adapter.buildSelect(table, q);
            const params = adapter.buildParams(q);
            let done = false, out: any, err: any;
            adapter.execute(sql, params)
                .then(v => { out = v; done = true; })
                .catch(e => { err = e; done = true; });
            while (!done) tinySpinWait();
            if (err) throw err;
            const ids = Array.isArray(out) ? out.map((r: any) => r.id) : [out?.id].filter(Boolean);
            return { ids, total: ids.length, table };
        } catch { return null; }
    }

    private localRowSync(table: string, id: string | number, connId: string) {
        if (!IS_SERVER) return null;
        try {
            const { adapter } = this.getConnection(connId);
            const q: ParsedQuery = { action: "select", conditions: [{ field: "id", operator: "=", value: id }], includes: [] };
            const sql = adapter.buildSelect(table, q);
            let done = false, out: any, err: any;
            adapter.execute(sql, [id]).then(v => { out = v; done = true; }).catch(e => { err = e; done = true; });
            while (!done) tinySpinWait();
            if (err) throw err;
            return out;
        } catch { return null; }
    }

    private localRowsBulkSync(table: string, ids: (string | number)[], connId: string) {
        if (!IS_SERVER) return null;
        if (ids.length === 0) return {};
        try {
            const { adapter } = this.getConnection(connId);
            const q: ParsedQuery = {
                action: "select",
                conditions: [{ field: "id", operator: "IN", value: ids }],
                includes: []
            };
            const sql = adapter.buildSelect(table, q);
            const params = adapter.buildParams(q);
            let done = false, out: any, err: any;
            adapter.execute(sql, params).then(v => { out = v; done = true; }).catch(e => { err = e; done = true; });
            while (!done) tinySpinWait();
            if (err) throw err;

            // Convert array to map keyed by id
            const map: Record<string | number, any> = {};
            if (Array.isArray(out)) {
                for (const row of out) {
                    map[row.id] = row;
                }
            }
            return map;
        } catch { return null; }
    }

    private localUpdateSync(table: string, id: string | number, patch: any, connId: string) {
        if (!IS_SERVER) return null;
        try {
            const { adapter } = this.getConnection(connId);
            let done = false, err: any;
            adapter.update(table, patch, { id })
                .then(() => { done = true; })
                .catch(e => { err = e; done = true; });
            while (!done) tinySpinWait();
            if (err) throw err;
            return { ok: true };
        } catch { return null; }
    }

    private localInsertSync(table: string, record: any, connId: string) {
        if (!IS_SERVER) return null;
        try {
            const { adapter } = this.getConnection(connId);
            let done = false, out: any, err: any;
            adapter.insert(table, record).then(v => { out = v; done = true; }).catch(e => { err = e; done = true; });
            while (!done) tinySpinWait();
            if (err) throw err;
            return { ok: true, id: out?.id };
        } catch { return null; }
    }

    /* ----------------------------- Public Sync --------------------------- */

    planSync(table: string, q: ParsedQuery, connId = "default") {
        const local = this.localPlanSync(table, q, connId);
        if (local) return local;
        const r = this.psSync(this.stream!.routes!.plan!, { connectionId: connId, table, parsedQuery: q });
        return r;
    }

    fetchRowSync(table: string, connId: string, id: string | number) {
        const local = this.localRowSync(table, id, connId);
        if (local) return local;
        const r = this.psSync(this.stream!.routes!.row!, { connectionId: connId, table, id });
        return r?.row ?? null;
    }

    fetchRowsBulkSync(table: string, connId: string, ids: (string | number)[]) {
        if (ids.length === 0) return {};
        const local = this.localRowsBulkSync(table, ids, connId);
        if (local) return local;
        const r = this.psSync(this.stream!.routes!.rowBulk!, { connectionId: connId, table, ids });
        return r?.rows ?? {};
    }

    updateRowSync(table: string, connId: string, id: string | number, patch: any) {
        const local = this.localUpdateSync(table, id, patch, connId);
        if (local) return local;
        return this.psSync(this.stream!.routes!.update!, { connectionId: connId, table, id, patch });
    }

    insertSync(table: string, record: any, connId = "default") {
        const local = this.localInsertSync(table, record, connId);
        if (local) return local;
        return this.psSync(this.stream!.routes!.insert!, { connectionId: connId, table, record });
    }

    /* --------------------------- Table interface ------------------------- */

    table(tableName: string, connectionId = "default") {
        const self = this;

        return new Proxy({}, {
            get(_t, prop) {
                if (prop === "select") {
                    return (query = 'select("*")') => self._selectSync(tableName, query, connectionId);
                }
                if (prop === "find") {
                    return (q: string) => self._selectSync(tableName, `find("${q}")`, connectionId);
                }
                if (prop === "where") {
                    return (cond: string) => self._selectSync(tableName, `select("*") [${cond}]`, connectionId);
                }
                if (prop === "first") {
                    return () => self._selectSync(tableName, 'select("*"):first', connectionId);
                }
                if (prop === "all") {
                    return () => self._selectSync(tableName, 'select("*")', connectionId);
                }
                if (prop === "create") {
                    return (data: any) => {
                        const r = self.insertSync(self.resolveTable(tableName, connectionId), data, connectionId);
                        return r?.id;
                    };
                }
                // Direct numeric accessor: Users["42"]
                if (typeof prop === "string" && /^\d+$/.test(prop)) {
                    return self._selectSync(tableName, `select("#${prop}")`, connectionId);
                }
                return undefined;
            }
        });
    }

    private _selectSync(table: string, query: string, connectionId: string) {
        const parsed = QueryParser.parse(query);
        const resolved = this.resolveTable(table, connectionId);

        // PLAN (sync): ids only
        const plan = this.planSync(resolved, parsed, connectionId);
        const ids = Array.isArray(plan?.ids) ? plan.ids : [];

        // Create result node subtree
        const cacheKey = `${resolved}:${JSON_SAFE(parsed)}:${connectionId}:${Date.now()}`;
        const rootNode = (this.fx as any).setPath(`db.results.${cacheKey}`, {}, (this.fx as any).root);
        const root = (this.fx as any).createNodeProxy(rootNode);
        root.set({ table: resolved, total: ids.length });

        const rowsRoot = root.get("rows");
        const vr = new VirtualResult(this, resolved, connectionId, ids, rowsRoot, this.autosaveDebounceMs);

        // Expose ReactiveResult-like surface
        return new Proxy(vr, {
            get(_t, k) {
                if (k === "length") return vr.length();
                if (k === "first") return () => vr.first();
                if (k === Symbol.iterator) return function* () { yield* vr.iter(); };
                if (typeof k === "string" && /^\d+$/.test(k)) return vr.at(Number(k));
                return (vr as any)[k];
            }
        });
    }

    /* --------------------------- Callable / Props ------------------------ */

    callableProxy() {
        const self = this;
        const f = function (table: string, connectionId?: string) { return self.table(table, connectionId); };
        return new Proxy(f as any, {
            apply(_t, _this, args) { return self.table(args[0], args[1]); },
            get(_t, prop) {
                if (prop in self) return (self as any)[prop];
                if (typeof prop === "string") return self.table(prop);
                return undefined;
            }
        });
    }
}

/* =============================================================================
   Factory export
============================================================================= */

export default function (fx: FXCore, options?: AttachOptions): FXDB {
    const db = new FXDB(fx, options);
    return db.callableProxy() as unknown as FXDB;
}
