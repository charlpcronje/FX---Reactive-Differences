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
  FXFlowPlugin: () => FXFlowPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class Evt {
  map = /* @__PURE__ */ new Map();
  on(ev, cb) {
    if (!this.map.has(ev)) this.map.set(ev, /* @__PURE__ */ new Set());
    this.map.get(ev).add(cb);
    return () => this.off(ev, cb);
  }
  off(ev, cb) {
    this.map.get(ev)?.delete(cb);
  }
  emit(ev, e) {
    for (const cb of Array.from(this.map.get(ev) || [])) {
      try {
        cb(e);
      } catch (err) {
        console.error(err);
      }
    }
  }
}
function stdin_default(fx, cfg = {}) {
  return new FXFlowPlugin(fx, cfg);
}
class FXFlowPlugin {
  name = "flow";
  version = "1.0.0";
  description = "Dynamic, reactive, cross-realm flows";
  fx;
  bus = new Evt();
  sabBridge = null;
  haveSerialize = false;
  haveSafe = false;
  haveTime = false;
  haveDB = false;
  // Accessor methods for FlowHandle
  getFXCore() {
    return this.fx;
  }
  resolvePath(path, root) {
    return this.fx.resolvePath(path, root) || null;
  }
  setPath(path, value, root) {
    return this.fx.setPath(path, value, root);
  }
  getRoot() {
    return this.fx.root;
  }
  getValue(node) {
    return this.fx.val(node);
  }
  setValue(node, value) {
    this.fx.set(node, value);
  }
  constructor(fx, cfg = {}) {
    this.fx = fx;
    this.autoloadDeps();
    this.mountRoot();
    this.installAPISurface();
    try {
      this.sabBridge = IS_CLIENT && typeof SharedArrayBuffer !== "undefined" ? new SABBridge() : null;
    } catch (e) {
      console.warn("[FX Flow] SABBridge unavailable, cross-realm flows will be limited");
      this.sabBridge = null;
    }
    const r = this.fx.setPath("flows.__defaults", {}, this.fx.root);
    this.fx.set(r, {
      order: cfg.order ?? "bfs",
      budgets: cfg.budgets ?? {},
      logSize: cfg.logSize ?? 128
    });
  }
  // ---------- Public API ----------
  flow(path) {
    const flowPath = path || `flows.flow_${Date.now().toString(36)}`;
    const node = this.fx.setPath(flowPath, {}, this.fx.root);
    this.fx.setPath(`${flowPath}.nodes`, {}, this.fx.root);
    this.fx.setPath(`${flowPath}.edges`, {}, this.fx.root);
    this.fx.setPath(`${flowPath}.runtime.queue`, [], this.fx.root);
    this.fx.setPath(
      `${flowPath}.runtime.stats`,
      { steps: 0 },
      this.fx.root
    );
    this.fx.setPath(`${flowPath}.runtime.shared`, {}, this.fx.root);
    this.fx.setPath(`${flowPath}.runtime.running`, false, this.fx.root);
    this.fx.setPath(`${flowPath}.events`, {}, this.fx.root);
    return new FlowHandle(this, flowPath);
  }
  on(ev, cb) {
    return this.bus.on(ev, cb);
  }
  off(ev, cb) {
    return this.bus.off(ev, cb);
  }
  serialize(flowPath) {
    if (!this.haveSerialize) {
      throw new Error("serialize plugin not present");
    }
    return globalThis.$plugins?.serialize?.wrap(
      this.fx.resolvePath(flowPath, this.fx.root) || this.fx.root
    );
  }
  deserialize(snap, targetPath) {
    if (!this.haveSerialize) {
      throw new Error("serialize plugin not present");
    }
    const target = this.fx.resolvePath(targetPath, this.fx.root) || this.fx.setPath(targetPath, {}, this.fx.root);
    return globalThis.$plugins.serialize.expand(snap, target);
  }
  // ---------- Internals ----------
  _defineNode(flowPath, name, def) {
    const npath = `${flowPath}.nodes.${name}`;
    const n = this.fx.setPath(npath, {}, this.fx.root);
    const bag = {
      runsOn: def.runsOn,
      next: def.next || [],
      parallelBoth: def.parallelBoth ?? "serverFirst",
      merge: def.merge ?? "last",
      retry: def.retry ?? false
    };
    this.fx.set(n, {
      ...bag,
      _meta: {
        hasEffect: !!def.effect,
        hasBranch: !!def.branch,
        hasGuard: !!def.guard
      }
    });
    n.__flowEffect = def.effect || null;
    n.__flowGuard = def.guard || null;
    n.__flowBranch = def.branch || null;
    this.fx.setPath(`${npath}.logs.ring`, [], this.fx.root);
    this.fx.setPath(`${npath}.logs.full`, [], this.fx.root);
    const proxy = this.fx.createNodeProxy(n);
    proxy.watch((nv, ov) => {
      if (nv === ov) return;
      if (n.__isExecuting) return;
      this._enqueue(flowPath, name, nv);
      this._pump(flowPath);
    });
    return proxy;
  }
  _enqueue(flowPath, nodeName, payload) {
    const qNode = this.fx.resolvePath(
      `${flowPath}.runtime.queue`,
      this.fx.root
    );
    let q = this.fx.val(qNode);
    if (!Array.isArray(q)) {
      q = [];
      this.fx.set(qNode, q);
    }
    q.push({
      node: nodeName,
      payload,
      time: Date.now(),
      traceId: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    });
    this.fx.set(qNode, q);
  }
  _pump(flowPath) {
    const defaults = this.fx.val(
      this.fx.resolvePath("flows.__defaults", this.fx.root)
    ) || {};
    const order = defaults.order ?? "bfs";
    const budgets = defaults.budgets ?? {};
    const start = Date.now();
    if (this.fx.val(
      this.fx.resolvePath(
        `${flowPath}.runtime.running`,
        this.fx.root
      )
    ) === true) return;
    this.fx.setPath(`${flowPath}.runtime.running`, true, this.fx.root);
    this.bus.emit("flow:start", { flow: flowPath });
    const qNode = this.fx.resolvePath(
      `${flowPath}.runtime.queue`,
      this.fx.root
    );
    const stats = this.fx.resolvePath(
      `${flowPath}.runtime.stats`,
      this.fx.root
    );
    const take = () => {
      const q = this.fx.val(qNode);
      return order === "bfs" ? q.shift() : q.pop();
    };
    try {
      while (true) {
        if (budgets.maxMillis && Date.now() - start > budgets.maxMillis) break;
        const item = take();
        if (!item) break;
        const { node: nodeName, payload, traceId } = item;
        this._executeNode(flowPath, nodeName, payload, traceId);
        const st = this.fx.val(stats) || {};
        this.fx.set(stats, { ...st, steps: (st.steps || 0) + 1 });
        if (budgets.maxSteps && (st.steps || 0) >= budgets.maxSteps) {
          break;
        }
      }
    } finally {
      this.fx.setPath(`${flowPath}.runtime.running`, false, this.fx.root);
      const q = this.fx.val(qNode);
      if (!q.length) this.bus.emit("flow:idle", { flow: flowPath });
    }
  }
  _executeNode(flowPath, nodeName, payload, traceId) {
    const npath = `${flowPath}.nodes.${nodeName}`;
    const node = this.fx.resolvePath(npath, this.fx.root);
    const def = this.fx.val(node);
    const hasEffect = !!node.__flowEffect;
    const guard = node.__flowGuard;
    const branch = node.__flowBranch;
    node.__isExecuting = true;
    const shared = this.fx.val(
      this.fx.resolvePath(
        `${flowPath}.runtime.shared`,
        this.fx.root
      )
    ) || {};
    const ctxBase = {
      in: payload,
      set: (v) => {
        this.fx.set(node, v);
      },
      // self-set (same value) breaks by watcher rule
      next: (name, pl) => this._enqueue(flowPath, name, pl),
      spawnFlow: (name, builder, autoStart) => {
        const h = new FlowHandle(this, `${flowPath}.subflows.${name}`);
        builder(h);
        if (autoStart) h.start(autoStart.atNode, autoStart.payload);
      },
      planFlow: (name, builder) => {
        const h = new FlowHandle(this, `${flowPath}.subflows.${name}`);
        builder(h);
      },
      log: (...a) => this._log(npath, "info", a),
      warn: (...a) => this._log(npath, "warn", a),
      error: (...a) => this._log(npath, "error", a),
      meta: def && def._meta || {},
      $db: globalThis.$db || globalThis.$plugins?.orm || null,
      traceId,
      shared,
      abortSignal: null
    };
    this.bus.emit(`node:before:${nodeName}`, {
      flow: flowPath,
      node: nodeName,
      in: payload,
      traceId
    });
    if (guard && !guard({ ...ctxBase, runOn: realm() })) {
      this._log(npath, "info", [`guard: vetoed execution`]);
      return;
    }
    const runsOn = def?.runsOn || "client";
    const call = (runOn) => {
      const ctx = { ...ctxBase, runOn };
      const doEffect = () => {
        if (!hasEffect) return;
        node.__flowEffect(ctx);
      };
      const doBranch = () => {
        if (!branch) return;
        if ("when" in branch) {
          const cond = !!branch.when(ctx);
          const target = cond ? branch.then : branch.else;
          if (target) this._enqueue(flowPath, target, ctx.in);
        } else {
          const key = branch.switch(ctx);
          const target = branch.cases[key] ?? branch.default;
          if (target) this._enqueue(flowPath, target, ctx.in);
        }
      };
      const tryOnce = () => {
        try {
          doEffect();
          doBranch();
          this.bus.emit(`node:after:${nodeName}`, {
            flow: flowPath,
            node: nodeName,
            traceId
          });
        } catch (e) {
          throw e;
        } finally {
          node.__isExecuting = false;
        }
      };
      const retry = def?.retry ?? false;
      if (!retry) return tryOnce();
      const spec = {
        maxAttempts: 3,
        backoffMs: 150,
        multiplier: 2,
        jitter: true,
        useSafePlugin: true,
        ...retry
      };
      if (spec.useSafePlugin && this.haveSafe && globalThis.$plugins?.safe) {
        globalThis.$plugins.safe.retry(
          `flow.${flowPath.replace(/\./g, "_")}.${nodeName}`,
          () => {
            tryOnce();
            return true;
          },
          spec
        ).execute(() => true);
        return;
      }
      let attempts = 0, delay = spec.backoffMs;
      const run = () => {
        try {
          attempts++;
          tryOnce();
        } catch (err) {
          this._log(npath, "error", [
            `retry ${attempts}`,
            String(err)
          ]);
          if (attempts < spec.maxAttempts) {
            const jitter = spec.jitter ? 0.5 + Math.random() * 0.5 : 1;
            const nextDelay = delay * (spec.multiplier || 2) * jitter;
            setTimeout(run, delay);
            delay = nextDelay;
          } else {
            this.bus.emit(`node:error:${nodeName}`, {
              flow: flowPath,
              node: nodeName,
              error: String(err),
              traceId
            });
          }
        }
      };
      run();
    };
    if (runsOn === "client") call("client");
    else if (runsOn === "server") {
      this._callServer(flowPath, nodeName, payload, traceId, npath, call);
    } else {
      const seq = def?.parallelBoth ?? "serverFirst";
      if (seq === "parallel") {
        call("client");
        this._callServer(
          flowPath,
          nodeName,
          payload,
          traceId,
          npath,
          call
        );
      } else if (seq === "clientFirst") {
        call("client");
        this._callServer(
          flowPath,
          nodeName,
          payload,
          traceId,
          npath,
          call
        );
      } else {
        this._callServer(
          flowPath,
          nodeName,
          payload,
          traceId,
          npath,
          call
        );
        call("client");
      }
    }
  }
  _callServer(flowPath, nodeName, payload, traceId, npath, localCall) {
    if (!IS_CLIENT) {
      localCall("server");
      return;
    }
    if (!this.sabBridge) {
      const serializePlugin = globalThis.__fxPlugins?.serialize;
      let serializedFlow = null;
      console.log("[FX-Flow] Attempting serialization...");
      console.log("[FX-Flow] serializePlugin available:", !!serializePlugin);
      console.log("[FX-Flow] this.haveSerialize:", this.haveSerialize);
      if (serializePlugin && this.haveSerialize) {
        try {
          const flowNode = this.fx.resolvePath(flowPath, this.fx.root);
          console.log("[FX-Flow] flowNode found:", !!flowNode);
          console.log("[FX-Flow] flowPath:", flowPath);
          if (flowNode) {
            serializedFlow = serializePlugin.wrap(flowNode);
            console.log("[FX-Flow] Serialization successful!");
            this._log(npath, "info", ["serialized flow for server", flowPath]);
          } else {
            console.warn("[FX-Flow] flowNode not found for path:", flowPath);
          }
        } catch (e) {
          console.error("[FX-Flow] Serialization failed:", e);
          this._log(npath, "warn", ["failed to serialize flow", String(e?.message || e)]);
        }
      } else {
        console.warn("[FX-Flow] Cannot serialize - plugin not available or flag not set");
      }
      const fetchPromise = fetch("/fx/flow/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          flow: flowPath,
          node: nodeName,
          payload,
          serializedFlow
        })
      }).then((res) => res.json()).then((result) => {
        if (result.ok) {
          this._log(npath, "info", ["server ok via HTTP", result.result]);
        } else {
          throw new Error(result.error);
        }
      }).catch((e) => {
        this._log(npath, "error", ["server HTTP err", String(e?.message || e)]);
      });
      if (typeof window !== "undefined" && typeof document !== "undefined") {
        throw new globalThis.FXSuspend(fetchPromise);
      }
      return;
    }
    try {
      const res = this.sabBridge.call({
        kind: "step",
        flow: flowPath,
        node: nodeName,
        payload,
        traceId
      });
      if (res.kind === "err") throw new Error(res.error);
      if (res.kind === "ok") {
        this._log(npath, "info", ["server ok", res.value]);
      }
    } catch (e) {
      this._log(npath, "error", ["server err", String(e?.message || e)]);
      localCall("server");
    }
  }
  _log(npath, level, args) {
    const ringN = this.fx.resolvePath(`${npath}.logs.ring`, this.fx.root);
    const fullN = this.fx.resolvePath(`${npath}.logs.full`, this.fx.root);
    const defaults = this.fx.val(
      this.fx.resolvePath("flows.__defaults", this.fx.root)
    ) || {};
    const size = defaults.logSize || 128;
    const entry = { ts: Date.now(), level, args };
    const ring = this.fx.val(ringN) || [];
    if (ring.length >= size) ring.shift();
    ring.push(entry);
    this.fx.set(ringN, ring);
    const full = this.fx.val(fullN) || [];
    full.push(entry);
    this.fx.set(fullN, full);
  }
  mountRoot() {
    this.fx.setPath("flows", {}, this.fx.root);
  }
  installAPISurface() {
    const flowsNode = this.fx.resolvePath("flows", this.fx.root);
    const p = this.fx.createNodeProxy(flowsNode);
    p.flow = (name) => this.flow(name);
    globalThis.$flow = (name) => this.flow(name);
  }
  autoloadDeps() {
    const pluginsObj = globalThis.__fxPlugins;
    try {
      this.haveSerialize = !!pluginsObj?.serialize;
    } catch {
    }
    try {
      this.haveSafe = !!pluginsObj?.safe;
    } catch {
    }
    try {
      this.haveTime = !!pluginsObj?.time;
    } catch {
    }
    try {
      this.haveDB = !!globalThis.$db || !!pluginsObj?.orm;
    } catch {
    }
  }
}
class FlowHandle {
  constructor(core, flowPath) {
    this.core = core;
    this.flowPath = flowPath;
  }
  node(name, def) {
    this.core._defineNode(this.flowPath, name, def);
    return this;
  }
  connect(from, ...to) {
    const root = this.core.getRoot();
    const ep = this.core.resolvePath(
      `${this.flowPath}.edges.${from}`,
      root
    ) || this.core.setPath(
      `${this.flowPath}.edges.${from}`,
      [],
      root
    );
    const arr = this.core.getValue(ep) || [];
    for (const t of to) if (!arr.includes(t)) arr.push(t);
    this.core.setValue(ep, arr);
    return this;
  }
  start(firstNode, payload) {
    this.core._enqueue(this.flowPath, firstNode, payload);
    this.core._pump(this.flowPath);
    return this;
  }
  set(name, value) {
    const root = this.core.getRoot();
    this.core.setPath(
      `${this.flowPath}.nodes.${name}`,
      value,
      root
    );
    return this;
  }
  on(ev, cb) {
    return this.core.on(ev, cb);
  }
  off(ev, cb) {
    return this.core.off(ev, cb);
  }
  serialize() {
    return this.core.serialize(this.flowPath);
  }
  deserialize(snap) {
    this.core.deserialize(snap, this.flowPath);
    return this;
  }
  // convenience sync-like loop runner: process queue until idle (or budgets)
  runSync(maxSteps = 1e6) {
    const root = this.core.getRoot();
    this.core.setPath(
      `${this.flowPath}.runtime.stats.steps`,
      0,
      root
    );
    this.core._pump(this.flowPath);
    return this;
  }
}
const IS_SERVER = typeof globalThis.Deno !== "undefined";
const IS_CLIENT = !IS_SERVER;
function realm() {
  return IS_SERVER ? "server" : "client";
}
class SABBridge {
  worker = null;
  sab;
  lock;
  len;
  buf;
  constructor() {
    if (!IS_CLIENT || typeof SharedArrayBuffer === "undefined") {
      throw new Error("SAB not available");
    }
    this.sab = new SharedArrayBuffer(2 * 1024 * 1024);
    this.lock = new Int32Array(this.sab, 0, 1);
    this.len = new Int32Array(this.sab, 4, 1);
    this.buf = new Uint8Array(this.sab, 8);
    const code = `
      self.onmessage = async (e) => {
        const { id, sab, payload } = e.data;
        const lock = new Int32Array(sab, 0, 1);
        const len  = new Int32Array(sab, 4, 1);
        const buf  = new Uint8Array(sab, 8);
        try {
          // route to FX.ps (server endpoint), echoing SAB to keep one copy
          const res = await fetch('/fx/proxy?url=' + encodeURIComponent('/fx/ps/flowStep'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const text = await res.text();
          const enc = new TextEncoder().encode(text);
          if (enc.length > buf.length) { Atomics.store(lock, 0, -id); Atomics.notify(lock, 0); return; }
          buf.set(enc); len[0] = enc.length; Atomics.store(lock, 0, id);
        } catch (err) { Atomics.store(lock, 0, -id); }
        Atomics.notify(lock, 0);
      };
    `;
    const blob = new Blob([code], { type: "application/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob));
  }
  call(msg) {
    const id = Math.floor(Math.random() * 1e9);
    Atomics.store(this.lock, 0, 0);
    this.worker.postMessage({ id, sab: this.sab, payload: msg });
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const p = Promise.resolve();
      throw new globalThis.FXSuspend(p);
    }
    const result = Atomics.wait(this.lock, 0, 0, 15e3);
    if (result === "timed-out") throw new Error("SABBridge timeout");
    const signal = Atomics.load(this.lock, 0);
    if (signal !== id) throw new Error("Bridge error / buffer too small");
    const n = this.len[0];
    const text = new TextDecoder().decode(this.buf.subarray(0, n));
    try {
      return JSON.parse(text);
    } catch {
      return { kind: "err", error: "Invalid JSON from server" };
    }
  }
}
