var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  FXDB: () => FXDB,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
const HAS_DENO = typeof globalThis.Deno !== "undefined";
const IS_SERVER = HAS_DENO;
const IS_CLIENT = !IS_SERVER;
const JSON_SAFE = (v) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};
const tinySpinWait = () => {
  if (typeof window !== "undefined") {
    const start = performance.now();
    while (performance.now() - start < 0.5) {
    }
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => {
    });
    return;
  }
  const sab = new SharedArrayBuffer(4);
  const i32 = new Int32Array(sab);
  Atomics.wait(i32, 0, 0, 2);
};
class QueryParser {
  static parse(query) {
    const out = { action: "select", conditions: [], includes: [] };
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
        case "first":
          out.limit = 1;
          break;
        case "last":
          out.limit = 1;
          out.orderBy = { field: "id", direction: "desc" };
          break;
        case "limit":
          out.limit = parseInt(v, 10);
          break;
        case "offset":
          out.offset = parseInt(v, 10);
          break;
        case "orderBy": {
          const [f, d = "asc"] = v.split(",");
          out.orderBy = { field: f.trim(), direction: d.trim() };
          break;
        }
        case "includes":
          out.includes = v.split(",").map((s) => s.trim());
          break;
      }
    }
    return out;
  }
  static op(o) {
    const map = {
      "=": "=",
      "!=": "!=",
      ">": ">",
      "<": "<",
      ">=": ">=",
      "<=": "<=",
      "^=": "LIKE_PREFIX",
      "$=": "LIKE_SUFFIX",
      "*=": "LIKE_CONTAINS",
      "~=": "IN"
    };
    return map[o] || "=";
  }
  static val(v) {
    if (/^\d+$/.test(v)) return parseInt(v, 10);
    if (/^\d*\.\d+$/.test(v)) return parseFloat(v);
    if (v === "true") return true;
    if (v === "false") return false;
    if (v === "null") return null;
    return v;
  }
}
class Fuzzy {
  static distance(a, b) {
    const m = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
    for (let i = 0; i <= a.length; i++) m[0][i] = i;
    for (let j = 0; j <= b.length; j++) m[j][0] = j;
    for (let j = 1; j <= b.length; j++) for (let i = 1; i <= a.length; i++) {
      const ind = a[i - 1] === b[j - 1] ? 0 : 1;
      m[j][i] = Math.min(m[j][i - 1] + 1, m[j - 1][i] + 1, m[j - 1][i - 1] + ind);
    }
    return m[b.length][a.length];
  }
  static norm(s) {
    return s.toLowerCase().replace(/s$/, "").replace(/ies$/, "y").replace(/es$/, "").replace(/[_-]/g, "");
  }
  static best(query, tables, threshold = 90) {
    const q = this.norm(query);
    let best = query, bestScore = 0;
    for (const t of tables) {
      const n = this.norm(t);
      if (q === n) return t;
      const max = Math.max(q.length, n.length);
      const dist = this.distance(q, n);
      const score = (max - dist) / max * 100;
      if (score > bestScore && score >= threshold) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }
}
class BaseAdapter {
  connectionString;
  isConnected = false;
  tables = [];
  constructor(cs) {
    this.connectionString = cs;
  }
  getTables() {
    return this.tables;
  }
  buildSelect(table, q) {
    let sql = `SELECT * FROM ${table}`;
    if (q.conditions.length) {
      sql += ` WHERE ` + q.conditions.map((c) => {
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
  buildParams(q) {
    const params = [];
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
  store = {
    users: Array.from({ length: 1e3 }).map((_, i) => ({
      id: i + 1,
      name: `User ${i + 1}`,
      email: `user${i + 1}@example.com`,
      age: 18 + i % 50,
      status: i % 3 ? "active" : "inactive"
    })),
    products: Array.from({ length: 300 }).map((_, i) => ({
      id: i + 1,
      name: `Product ${i + 1}`,
      price: 5 + i % 100
    }))
  };
  async connect() {
    this.isConnected = true;
    this.tables = Object.keys(this.store);
  }
  async disconnect() {
    this.isConnected = false;
  }
  async execute(sql, params = []) {
    const table = /from\s+(\w+)/i.exec(sql)?.[1] || "users";
    let rows = [...this.store[table] || []];
    if (/where\s+id\s*=\s*\?/i.test(sql)) {
      const id = params[0];
      const r = rows.find((x) => String(x.id) === String(id));
      return r ?? null;
    }
    if (/where\s+id\s+in\s*\(/i.test(sql)) {
      const ids = params.map(String);
      rows = rows.filter((x) => ids.includes(String(x.id)));
      return rows;
    }
    const mLimit = /limit\s+(\d+)/i.exec(sql);
    if (mLimit) rows.splice(Number(mLimit[1]));
    return rows;
  }
  async insert(table, data) {
    const arr = this.store[table] || (this.store[table] = []);
    const id = (arr[arr.length - 1]?.id ?? 0) + 1;
    const rec = { id, ...data };
    arr.push(rec);
    return { id, ...rec };
  }
  async update(table, data, where) {
    const arr = this.store[table] || [];
    const idx = arr.findIndex((r) => r.id == where.id);
    if (idx >= 0) arr[idx] = { ...arr[idx], ...data };
    return arr[idx];
  }
  async delete(table, where) {
    const arr = this.store[table] || [];
    const idx = arr.findIndex((r) => r.id == where.id);
    if (idx >= 0) arr.splice(idx, 1);
    return true;
  }
}
class SyncRPC {
  sab = null;
  lock;
  len;
  buf;
  worker = null;
  BUF_SIZE = 2 * 1024 * 1024;
  // 2MB
  TIMEOUT_MS = 15e3;
  cache = /* @__PURE__ */ new Map();
  makeKey(url, body, headers) {
    return url + "|" + JSON.stringify(body ?? null) + "|" + JSON.stringify(headers ?? {});
  }
  constructor() {
    if (IS_CLIENT) this.initClient();
  }
  initClient() {
    if (typeof SharedArrayBuffer === "undefined" || (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated)) {
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
  callSync(url, body, headers = {}) {
    const key = this.makeKey(url, body, headers);
    if (this.cache.has(key)) {
      const text2 = this.cache.get(key);
      try {
        return JSON.parse(text2);
      } catch {
        return text2;
      }
    }
    const onUI = typeof window !== "undefined" && typeof document !== "undefined";
    if (onUI) {
      const p = this.callAsync(url, body, headers).catch(() => {
      });
      throw new globalThis.FXSuspend(p);
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
    const r = Atomics.wait(this.lock, 0, 0, this.TIMEOUT_MS);
    if (r === "timed-out") throw new Error("SyncRPC timeout " + url);
    const signal = Atomics.load(this.lock, 0);
    if (signal !== id) throw new Error("SyncRPC error/buffer too small " + url);
    const n = this.len[0];
    const text = new TextDecoder().decode(this.buf.subarray(0, n));
    this.cache.set(key, text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  async callAsync(url, body, headers = {}) {
    const key = this.makeKey(url, body, headers);
    if (this.cache.has(key)) {
      const text2 = this.cache.get(key);
      try {
        return JSON.parse(text2);
      } catch {
        return text2;
      }
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
    const onUI = typeof window !== "undefined" && typeof document !== "undefined";
    let status = "ok";
    if (onUI) {
      const anyAtomics = Atomics;
      if (typeof anyAtomics.waitAsync === "function") {
        const r = anyAtomics.waitAsync(this.lock, 0, 0, this.TIMEOUT_MS);
        status = r?.async === false ? r.value : await r.value;
      } else {
        const start = performance.now();
        while (Atomics.load(this.lock, 0) === 0) {
          if (performance.now() - start > this.TIMEOUT_MS) {
            status = "timed-out";
            break;
          }
          const t0 = performance.now();
          while (performance.now() - t0 < 0.5) {
          }
          await new Promise(requestAnimationFrame);
        }
        status = status || "ok";
      }
    } else {
      const r = Atomics.wait(this.lock, 0, 0, this.TIMEOUT_MS);
      status = r || "ok";
    }
    if (status === "timed-out") throw new Error("SyncRPC timeout " + url);
    const signal = Atomics.load(this.lock, 0);
    if (signal !== id) throw new Error("SyncRPC error/buffer too small " + url);
    const n = this.len[0];
    const text = new TextDecoder().decode(this.buf.subarray(0, n));
    this.cache.set(key, text);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
class RowProxy {
  orm;
  table;
  connId;
  rec;
  fxNode;
  savingFromWatch = false;
  debounceMs;
  parent;
  constructor(orm, table, connId, rec, node, debounceMs, parent) {
    this.orm = orm;
    this.table = table;
    this.connId = connId;
    this.rec = rec;
    this.fxNode = node;
    this.debounceMs = debounceMs;
    this.parent = parent || null;
    node.set({ id: rec.id });
    node.watch((nv, _ov) => {
      if (this.savingFromWatch) return;
      if (!this.rec.loaded) return;
      if (nv && typeof nv === "object") {
        this.rec.data = { ...this.rec.data, ...nv };
        this.scheduleSaveSync();
      }
    });
  }
  ensureLoadedSync() {
    if (this.rec.loaded) return;
    if (this.parent) {
      this.parent.batchLoadUnloaded();
    }
    if (!this.rec.loaded) {
      const row = this.orm.fetchRowSync(this.table, this.connId, this.rec.id);
      this.rec.data = row || { id: this.rec.id };
      this.rec.loaded = true;
    }
    this.fxNode.set(this.rec.data);
  }
  scheduleSaveSync() {
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
  get proxy() {
    const self = this;
    return new Proxy({}, {
      get(_t, key) {
        if (key === "__id") return self.rec.id;
        if (key === "__loaded") return self.rec.loaded;
        if (key === "__load") return () => self.ensureLoadedSync();
        if (key === "__save") return () => self.scheduleSaveSync();
        self.ensureLoadedSync();
        return self.rec.data?.[key];
      },
      set(_t, key, val) {
        self.ensureLoadedSync();
        self.rec.data[key] = val;
        self.fxNode.set(self.rec.data);
        self.scheduleSaveSync();
        return true;
      },
      ownKeys() {
        return ["id"];
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true };
      }
    });
  }
}
class VirtualResult {
  orm;
  table;
  connId;
  ids;
  rowsRoot;
  rows = /* @__PURE__ */ new Map();
  debounceMs;
  batchLoadInProgress = false;
  constructor(orm, table, connId, ids, rowsRoot, debounceMs) {
    this.orm = orm;
    this.table = table;
    this.connId = connId;
    this.ids = ids;
    this.rowsRoot = rowsRoot;
    this.debounceMs = debounceMs;
  }
  length() {
    return this.ids.length;
  }
  at(i) {
    const id = this.ids[i];
    if (id === void 0) return void 0;
    let rp = this.rows.get(id);
    if (!rp) {
      const node = this.rowsRoot.get(String(id));
      rp = new RowProxy(this.orm, this.table, this.connId, { id, loaded: false }, node, this.debounceMs, this);
      this.rows.set(id, rp);
    }
    return rp.proxy;
  }
  *iter() {
    for (let i = 0; i < this.ids.length; i++) yield this.at(i);
  }
  first() {
    return this.at(0);
  }
  // Smart batch loading: load all unloaded rows in one query
  batchLoadUnloaded() {
    if (this.batchLoadInProgress) return;
    const unloadedIds = [];
    const unloadedItems = [];
    for (const [id, rp] of this.rows.entries()) {
      const rec = rp.rec;
      if (!rec.loaded) {
        unloadedIds.push(id);
        unloadedItems.push({ rec, rp });
      }
    }
    if (unloadedIds.length > 1) {
      this.batchLoadInProgress = true;
      try {
        const rowsMap = this.orm.fetchRowsBulkSync(this.table, this.connId, unloadedIds);
        for (const { rec, rp } of unloadedItems) {
          rec.data = rowsMap[rec.id] || { id: rec.id };
          rec.loaded = true;
          rp.fxNode.set(rec.data);
        }
      } finally {
        this.batchLoadInProgress = false;
      }
    }
  }
}
class FXDB {
  fx;
  rpc = new SyncRPC();
  connections = /* @__PURE__ */ new Map();
  stream;
  autosaveDebounceMs = 600;
  name = "db";
  version = "3.1.0";
  constructor(fx, opts = {}) {
    this.fx = fx;
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
    if (opts.defaultConnectionString && IS_SERVER) {
      this.connect(opts.defaultConnectionString).catch(() => {
      });
    }
  }
  /* ---------------------------- Connections ---------------------------- */
  async connect(connectionString, options = {}) {
    const name = options.name || "default";
    const adapter = new MockAdapter(connectionString);
    await adapter.connect();
    this.connections.set(name, { adapter, type: this.detectDb(connectionString) });
  }
  detectDb(cs) {
    if (cs.startsWith("postgres://") || cs.startsWith("postgresql://")) return "postgres";
    if (cs.startsWith("mysql://")) return "mysql";
    if (cs.startsWith("sqlite://") || cs.includes(".db")) return "sqlite";
    if (cs.startsWith("mongodb://")) return "mongodb";
    return "unknown";
  }
  getConnection(id = "default") {
    const c = this.connections.get(id);
    if (!c) throw new Error(`No connection: ${id}`);
    return c;
  }
  /* ------------------------------ Utilities ---------------------------- */
  url(path) {
    if (!this.stream) throw new Error("No connectionStream configured for $db");
    return this.stream.baseUrl + (path.startsWith("/") ? path : "/" + path);
  }
  psSync(path, body) {
    if (!this.stream) throw new Error("No connectionStream configured for $db");
    return this.rpc.callSync(this.url(path), body, this.stream.headers);
  }
  resolveTable(name, connectionId) {
    try {
      const { adapter } = this.getConnection(connectionId);
      const tables = adapter.getTables() || [name];
      return Fuzzy.best(name, tables) || name;
    } catch {
      return name;
    }
  }
  /* --------------------- Local (server) sync fallbacks ----------------- */
  localPlanSync(table, q, connId) {
    if (!IS_SERVER) return null;
    try {
      const { adapter } = this.getConnection(connId);
      const sql = adapter.buildSelect(table, q);
      const params = adapter.buildParams(q);
      let done = false, out, err;
      adapter.execute(sql, params).then((v) => {
        out = v;
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      while (!done) tinySpinWait();
      if (err) throw err;
      const ids = Array.isArray(out) ? out.map((r) => r.id) : [out?.id].filter(Boolean);
      return { ids, total: ids.length, table };
    } catch {
      return null;
    }
  }
  localRowSync(table, id, connId) {
    if (!IS_SERVER) return null;
    try {
      const { adapter } = this.getConnection(connId);
      const q = { action: "select", conditions: [{ field: "id", operator: "=", value: id }], includes: [] };
      const sql = adapter.buildSelect(table, q);
      let done = false, out, err;
      adapter.execute(sql, [id]).then((v) => {
        out = v;
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      while (!done) tinySpinWait();
      if (err) throw err;
      return out;
    } catch {
      return null;
    }
  }
  localRowsBulkSync(table, ids, connId) {
    if (!IS_SERVER) return null;
    if (ids.length === 0) return {};
    try {
      const { adapter } = this.getConnection(connId);
      const q = {
        action: "select",
        conditions: [{ field: "id", operator: "IN", value: ids }],
        includes: []
      };
      const sql = adapter.buildSelect(table, q);
      const params = adapter.buildParams(q);
      let done = false, out, err;
      adapter.execute(sql, params).then((v) => {
        out = v;
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      while (!done) tinySpinWait();
      if (err) throw err;
      const map = {};
      if (Array.isArray(out)) {
        for (const row of out) {
          map[row.id] = row;
        }
      }
      return map;
    } catch {
      return null;
    }
  }
  localUpdateSync(table, id, patch, connId) {
    if (!IS_SERVER) return null;
    try {
      const { adapter } = this.getConnection(connId);
      let done = false, err;
      adapter.update(table, patch, { id }).then(() => {
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      while (!done) tinySpinWait();
      if (err) throw err;
      return { ok: true };
    } catch {
      return null;
    }
  }
  localInsertSync(table, record, connId) {
    if (!IS_SERVER) return null;
    try {
      const { adapter } = this.getConnection(connId);
      let done = false, out, err;
      adapter.insert(table, record).then((v) => {
        out = v;
        done = true;
      }).catch((e) => {
        err = e;
        done = true;
      });
      while (!done) tinySpinWait();
      if (err) throw err;
      return { ok: true, id: out?.id };
    } catch {
      return null;
    }
  }
  /* ----------------------------- Public Sync --------------------------- */
  planSync(table, q, connId = "default") {
    const local = this.localPlanSync(table, q, connId);
    if (local) return local;
    const r = this.psSync(this.stream.routes.plan, { connectionId: connId, table, parsedQuery: q });
    return r;
  }
  fetchRowSync(table, connId, id) {
    const local = this.localRowSync(table, id, connId);
    if (local) return local;
    const r = this.psSync(this.stream.routes.row, { connectionId: connId, table, id });
    return r?.row ?? null;
  }
  fetchRowsBulkSync(table, connId, ids) {
    if (ids.length === 0) return {};
    const local = this.localRowsBulkSync(table, ids, connId);
    if (local) return local;
    const r = this.psSync(this.stream.routes.rowBulk, { connectionId: connId, table, ids });
    return r?.rows ?? {};
  }
  updateRowSync(table, connId, id, patch) {
    const local = this.localUpdateSync(table, id, patch, connId);
    if (local) return local;
    return this.psSync(this.stream.routes.update, { connectionId: connId, table, id, patch });
  }
  insertSync(table, record, connId = "default") {
    const local = this.localInsertSync(table, record, connId);
    if (local) return local;
    return this.psSync(this.stream.routes.insert, { connectionId: connId, table, record });
  }
  /* --------------------------- Table interface ------------------------- */
  table(tableName, connectionId = "default") {
    const self = this;
    return new Proxy({}, {
      get(_t, prop) {
        if (prop === "select") {
          return (query = 'select("*")') => self._selectSync(tableName, query, connectionId);
        }
        if (prop === "find") {
          return (q) => self._selectSync(tableName, `find("${q}")`, connectionId);
        }
        if (prop === "where") {
          return (cond) => self._selectSync(tableName, `select("*") [${cond}]`, connectionId);
        }
        if (prop === "first") {
          return () => self._selectSync(tableName, 'select("*"):first', connectionId);
        }
        if (prop === "all") {
          return () => self._selectSync(tableName, 'select("*")', connectionId);
        }
        if (prop === "create") {
          return (data) => {
            const r = self.insertSync(self.resolveTable(tableName, connectionId), data, connectionId);
            return r?.id;
          };
        }
        if (typeof prop === "string" && /^\d+$/.test(prop)) {
          return self._selectSync(tableName, `select("#${prop}")`, connectionId);
        }
        return void 0;
      }
    });
  }
  _selectSync(table, query, connectionId) {
    const parsed = QueryParser.parse(query);
    const resolved = this.resolveTable(table, connectionId);
    const plan = this.planSync(resolved, parsed, connectionId);
    const ids = Array.isArray(plan?.ids) ? plan.ids : [];
    const cacheKey = `${resolved}:${JSON_SAFE(parsed)}:${connectionId}:${Date.now()}`;
    const rootNode = this.fx.setPath(`db.results.${cacheKey}`, {}, this.fx.root);
    const root = this.fx.createNodeProxy(rootNode);
    root.set({ table: resolved, total: ids.length });
    const rowsRoot = root.get("rows");
    const vr = new VirtualResult(this, resolved, connectionId, ids, rowsRoot, this.autosaveDebounceMs);
    return new Proxy(vr, {
      get(_t, k) {
        if (k === "length") return vr.length();
        if (k === "first") return () => vr.first();
        if (k === Symbol.iterator) return function* () {
          yield* vr.iter();
        };
        if (typeof k === "string" && /^\d+$/.test(k)) return vr.at(Number(k));
        return vr[k];
      }
    });
  }
  /* --------------------------- Callable / Props ------------------------ */
  callableProxy() {
    const self = this;
    const f = function(table, connectionId) {
      return self.table(table, connectionId);
    };
    return new Proxy(f, {
      apply(_t, _this, args) {
        return self.table(args[0], args[1]);
      },
      get(_t, prop) {
        if (prop in self) return self[prop];
        if (typeof prop === "string") return self.table(prop);
        return void 0;
      }
    });
  }
}
function stdin_default(fx, options) {
  const db = new FXDB(fx, options);
  return db.callableProxy();
}
