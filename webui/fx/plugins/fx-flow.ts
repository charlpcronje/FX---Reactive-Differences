// /plugins/fx-flow.ts
/**
 * FXFlow — Dynamic, Reactive, Cross-Realm Procedure Graphs
 * - Dynamic flow creation & subflows
 * - Branching (if/else/switch/predicate), guards, retries/backoff
 * - Before/After node events + global bus
 * - Sync-like scheduler (BFS) with budgets & break-by-self-set semantics
 * - Cross-realm execution: runsOn: "client" | "server" | "both"
 * - SAB/Atomics bridge for server steps (no latency leak to main FX)
 * - Logs live inside each node; whole flow is serializable/hydratable
 * - Integrations: $db (ORM), serialize, safe (retry/circuit), time (snapshots)
 */

import type { FXCore, FXNode, FXNodeProxy } from "../fx.v4";

type RunTarget = "client" | "server" | "both";
type MergeStrategy = "last" | "all" | "reduce";

type BranchSpec =
    | { when: (ctx: NodeCtx) => boolean; then: string; else?: string }
    | {
        switch: (ctx: NodeCtx) => string;
        cases: Record<string, string>;
        default?: string;
    };

type RetrySpec = false | {
    maxAttempts?: number; // default 3
    backoffMs?: number; // default 150
    multiplier?: number; // default 2
    jitter?: boolean; // default true
    useSafePlugin?: boolean; // if fx-safe present, delegate retry to it
};

type OnEvent =
    | "flow:start"
    | "flow:idle"
    | "flow:error"
    | "flow:finish"
    | `node:before:${string}`
    | `node:after:${string}`
    | `node:error:${string}`;

type Effect = (ctx: NodeCtx) => void;

interface NodeDef {
    runsOn: RunTarget;
    effect?: Effect; // main body
    branch?: BranchSpec; // optional static branch
    next?: string[]; // default downstream(s) if not using ctx.next()
    merge?: MergeStrategy | {
        strategy: MergeStrategy;
        reducer?: (acc: any, cur: any) => any;
    };
    retry?: RetrySpec;
    parallelBoth?: "serverFirst" | "clientFirst" | "parallel"; // if runsOn==="both"
    guard?: (ctx: NodeCtx) => boolean; // veto execution
}

interface FlowConfig {
    name?: string;
    order?: "bfs" | "dfs";
    budgets?: { maxSteps?: number; maxMillis?: number; maxDepth?: number };
    logSize?: number; // ring size per node
}

type SABMessage =
    | {
        kind: "step";
        flow: string;
        node: string;
        payload: any;
        traceId: string;
    }
    | { kind: "ok"; value?: any; logs?: any[] }
    | { kind: "err"; error: string };

type NodeCtx = {
    in: any;
    set: (v: any) => void; // sets this node's value (self-set => break)
    next: (nodeName: string, payload?: any) => void; // push to downstream now
    spawnFlow: (
        name: string,
        builder: (f: FlowAPI) => void,
        autoStart?: { atNode: string; payload?: any },
    ) => void;
    planFlow: (name: string, builder: (f: FlowAPI) => void) => void; // create but don't start
    log: (...a: any[]) => void;
    warn: (...a: any[]) => void;
    error: (...a: any[]) => void;
    meta: Record<string, any>;
    $db: any; // injected if available
    traceId: string;
    shared: Record<string, any>;
    abortSignal: AbortSignal | null;
    runOn: RunTarget; // actual realm this execution is happening on
};

class Evt {
    private map = new Map<string, Set<Function>>();
    on<T = any>(ev: string, cb: (e: T) => void) {
        if (!this.map.has(ev)) this.map.set(ev, new Set());
        this.map.get(ev)!.add(cb);
        return () => this.off(ev, cb);
    }
    off(ev: string, cb: Function) {
        this.map.get(ev)?.delete(cb);
    }
    emit<T = any>(ev: string, e: T) {
        for (const cb of Array.from(this.map.get(ev) || [])) {
            try {
                (cb as any)(e);
            } catch (err) {
                console.error(err);
            }
        }
    }
}

export default function (fx: FXCore, cfg: Partial<FlowConfig> = {}) {
    return new FXFlowPlugin(fx, cfg);
}

export class FXFlowPlugin {
    public readonly name = "flow";
    public readonly version = "1.0.0";
    public readonly description = "Dynamic, reactive, cross-realm flows";

    private fx: FXCore;
    private bus = new Evt();
    private sabBridge: SABBridge | null = null;
    private haveSerialize = false;
    private haveSafe = false;
    private haveTime = false;
    private haveDB = false;
    
    // Accessor methods for FlowHandle
    getFXCore(): FXCore {
        return this.fx;
    }
    
    resolvePath(path: string, root: FXNode): FXNode | null {
        return this.fx.resolvePath(path, root) || null;
    }
    
    setPath(path: string, value: any, root: FXNode): FXNode {
        return this.fx.setPath(path, value, root);
    }
    
    getRoot(): FXNode {
        return this.fx.root;
    }
    
    getValue(node: FXNode): any {
        return this.fx.val(node);
    }
    
    setValue(node: FXNode, value: any): void {
        this.fx.set(node, value);
    }

    constructor(fx: FXCore, cfg: Partial<FlowConfig> = {}) {
        this.fx = fx;
        this.autoloadDeps();
        this.mountRoot();
        this.installAPISurface();
        // Only create SABBridge if SharedArrayBuffer is available
        try {
            this.sabBridge = IS_CLIENT && typeof SharedArrayBuffer !== 'undefined' ? new SABBridge() : null;
        } catch (e) {
            console.warn('[FX Flow] SABBridge unavailable, cross-realm flows will be limited');
            this.sabBridge = null;
        }
        // store defaults
        const r = this.fx.setPath("flows.__defaults", {}, this.fx.root);
        this.fx.set(r, {
            order: cfg.order ?? "bfs",
            budgets: cfg.budgets ?? {},
            logSize: cfg.logSize ?? 128,
        });
    }

    // ---------- Public API ----------
    flow(path?: string): FlowAPI {
        const flowPath = path || `flows.flow_${Date.now().toString(36)}`;
        const node = this.fx.setPath(flowPath, {}, this.fx.root);
        // ensure structure
        this.fx.setPath(`${flowPath}.nodes`, {}, this.fx.root);
        this.fx.setPath(`${flowPath}.edges`, {}, this.fx.root);
        this.fx.setPath(`${flowPath}.runtime.queue`, [], this.fx.root);
        this.fx.setPath(
            `${flowPath}.runtime.stats`,
            { steps: 0 },
            this.fx.root,
        );
        this.fx.setPath(`${flowPath}.runtime.shared`, {}, this.fx.root);
        this.fx.setPath(`${flowPath}.runtime.running`, false, this.fx.root);
        this.fx.setPath(`${flowPath}.events`, {}, this.fx.root);

        return new FlowHandle(this, flowPath);
    }

    on(ev: OnEvent, cb: (e: any) => void) {
        return this.bus.on(ev, cb);
    }
    off(ev: OnEvent, cb: (e: any) => void) {
        return this.bus.off(ev, cb);
    }

    serialize(flowPath: string) {
        if (!this.haveSerialize) {
            throw new Error("serialize plugin not present");
        }
        return (globalThis as any).$plugins?.serialize?.wrap(
            this.fx.resolvePath(flowPath, this.fx.root) || this.fx.root,
        ); // fx-serialize wrap/expand live here
    }

    deserialize(snap: any, targetPath: string) {
        if (!this.haveSerialize) {
            throw new Error("serialize plugin not present");
        }
        const target = this.fx.resolvePath(targetPath, this.fx.root) ||
            this.fx.setPath(targetPath, {}, this.fx.root);
        return (globalThis as any).$plugins.serialize.expand(snap, target);
    }

    // ---------- Internals ----------
    _defineNode(flowPath: string, name: string, def: NodeDef) {
        const npath = `${flowPath}.nodes.${name}`;
        const n = this.fx.setPath(npath, {}, this.fx.root);
        // store definition (not serializing functions; serialize plugin will store metadata only)
        const bag = {
            runsOn: def.runsOn,
            next: def.next || [],
            parallelBoth: def.parallelBoth ?? "serverFirst",
            merge: def.merge ?? "last",
            retry: def.retry ?? false,
        };
        this.fx.set(n, {
            ...bag,
            _meta: {
                hasEffect: !!def.effect,
                hasBranch: !!def.branch,
                hasGuard: !!def.guard,
            },
        });

        // attach effect & helpers (not serializable; rebuilt on load)
        (n as any).__flowEffect = def.effect || null;
        (n as any).__flowGuard = def.guard || null;
        (n as any).__flowBranch = def.branch || null;

        // logs
        this.fx.setPath(`${npath}.logs.ring`, [], this.fx.root);
        this.fx.setPath(`${npath}.logs.full`, [], this.fx.root);

        // watcher: when value set, enqueue execution
        const proxy = this.fx.createNodeProxy(n);
        proxy.watch((nv: any, ov: any) => {
            // self-set break: if ===, do nothing
            if (nv === ov) return;
            // Don't re-enqueue if we're currently executing this node
            if ((n as any).__isExecuting) return;
            this._enqueue(flowPath, name, nv);
            this._pump(flowPath);
        });

        return proxy;
    }

    _enqueue(flowPath: string, nodeName: string, payload: any) {
        const qNode = this.fx.resolvePath(
            `${flowPath}.runtime.queue`,
            this.fx.root,
        )!;
        let q = this.fx.val(qNode) as any[];

        // Ensure queue is an actual array (in case of deserialization)
        if (!Array.isArray(q)) {
            q = [];
            this.fx.set(qNode, q);
        }

        q.push({
            node: nodeName,
            payload,
            time: Date.now(),
            traceId: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)
                }`,
        });
        this.fx.set(qNode, q);
    }

    _pump(flowPath: string) {
        const defaults = (this.fx.val(
            this.fx.resolvePath("flows.__defaults", this.fx.root)!,
        ) || {}) as FlowConfig;
        const order = defaults.order ?? "bfs";
        const budgets = defaults.budgets ?? {};
        const start = Date.now();
        if (
            this.fx.val(
                this.fx.resolvePath(
                    `${flowPath}.runtime.running`,
                    this.fx.root,
                )!,
            ) === true
        ) return;

        this.fx.setPath(`${flowPath}.runtime.running`, true, this.fx.root);
        this.bus.emit("flow:start", { flow: flowPath });

        const qNode = this.fx.resolvePath(
            `${flowPath}.runtime.queue`,
            this.fx.root,
        )!;
        const stats = this.fx.resolvePath(
            `${flowPath}.runtime.stats`,
            this.fx.root,
        )!;

        const take = () => {
            const q = this.fx.val(qNode) as any[];
            return order === "bfs" ? q.shift() : q.pop();
        };

        try {
            while (true) {
                if (
                    budgets.maxMillis && Date.now() - start > budgets.maxMillis
                ) break;
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
            // idle?
            const q = this.fx.val(qNode) as any[];
            if (!q.length) this.bus.emit("flow:idle", { flow: flowPath });
        }
    }

    _executeNode(
        flowPath: string,
        nodeName: string,
        payload: any,
        traceId: string,
    ) {
        const npath = `${flowPath}.nodes.${nodeName}`;
        const node = this.fx.resolvePath(npath, this.fx.root)!;
        const def = this.fx.val(node) as any;
        const hasEffect = !!(node as any).__flowEffect;
        const guard = (node as any).__flowGuard as (
            ctx: NodeCtx,
        ) => boolean | null;
        const branch = (node as any).__flowBranch as BranchSpec | null;

        // Set executing flag to prevent re-enqueueing during execution
        (node as any).__isExecuting = true;

        // build ctx
        const shared = this.fx.val(
            this.fx.resolvePath(
                `${flowPath}.runtime.shared`,
                this.fx.root,
            )!,
        ) || {};
        const ctxBase: Omit<NodeCtx, "runOn"> = {
            in: payload,
            set: (v: any) => {
                this.fx.set(node, v);
            }, // self-set (same value) breaks by watcher rule
            next: (name: string, pl?: any) => this._enqueue(flowPath, name, pl),
            spawnFlow: (name, builder, autoStart) => {
                const h = new FlowHandle(this, `${flowPath}.subflows.${name}`);
                builder(h);
                if (autoStart) h.start(autoStart.atNode, autoStart.payload);
            },
            planFlow: (name, builder) => {
                const h = new FlowHandle(this, `${flowPath}.subflows.${name}`);
                builder(h);
            },
            log: (...a: any[]) => this._log(npath, "info", a),
            warn: (...a: any[]) => this._log(npath, "warn", a),
            error: (...a: any[]) => this._log(npath, "error", a),
            meta: (def && def._meta) || {},
            $db: (globalThis as any).$db || (globalThis as any).$plugins?.orm ||
                null,
            traceId,
            shared,
            abortSignal: null,
        };

        // before event
        this.bus.emit(`node:before:${nodeName}`, {
            flow: flowPath,
            node: nodeName,
            in: payload,
            traceId,
        });

        // guard
        if (guard && !guard({ ...ctxBase, runOn: realm() })) {
            this._log(npath, "info", [`guard: vetoed execution`]);
            return;
        }

        // where should we run?
        const runsOn = (def?.runsOn || "client") as RunTarget;

        // evented invocation with retry/branching
        const call = (runOn: RunTarget) => {
            const ctx: NodeCtx = { ...ctxBase, runOn };

            const doEffect = () => {
                if (!hasEffect) return;
                (node as any).__flowEffect(ctx);
            };

            // static branch shortcut if provided and effect didn't direct next()
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

            // retries
            const tryOnce = () => {
                try {
                    doEffect();
                    doBranch();
                    this.bus.emit(`node:after:${nodeName}`, {
                        flow: flowPath,
                        node: nodeName,
                        traceId,
                    });
                } catch (e: any) {
                    throw e;
                } finally {
                    // Reset executing flag after execution
                    (node as any).__isExecuting = false;
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
                ...(retry as any),
            };
            if (
                spec.useSafePlugin && this.haveSafe &&
                (globalThis as any).$plugins?.safe
            ) {
                // delegate to fx-safe retry (async under the hood; our queue remains sync because we don't await)
                (globalThis as any).$plugins.safe.retry(
                    `flow.${flowPath.replace(/\./g, "_")}.${nodeName}`,
                    () => {
                        tryOnce();
                        return true;
                    },
                    spec,
                ).execute(() => true);
                return;
            }

            // inline simple retry (sync-ish; backoff via setTimeout but we don't block mainline; FX remains sync to the caller)
            let attempts = 0, delay = spec.backoffMs;
            const run = () => {
                try {
                    attempts++;
                    tryOnce();
                } catch (err) {
                    this._log(npath, "error", [
                        `retry ${attempts}`,
                        String(err),
                    ]);
                    if (attempts < spec.maxAttempts!) {
                        const jitter = spec.jitter
                            ? (0.5 + Math.random() * 0.5)
                            : 1;
                        const nextDelay = delay * (spec.multiplier || 2) *
                            jitter;
                        setTimeout(run, delay);
                        delay = nextDelay;
                    } else {
                        this.bus.emit(`node:error:${nodeName}`, {
                            flow: flowPath,
                            node: nodeName,
                            error: String(err),
                            traceId,
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
                    call,
                );
            } else if (seq === "clientFirst") {
                call("client");
                this._callServer(
                    flowPath,
                    nodeName,
                    payload,
                    traceId,
                    npath,
                    call,
                );
            } else {
                this._callServer(
                    flowPath,
                    nodeName,
                    payload,
                    traceId,
                    npath,
                    call,
                );
                call("client");
            }
        }
    }

    _callServer(
        flowPath: string,
        nodeName: string,
        payload: any,
        traceId: string,
        npath: string,
        localCall: (where: RunTarget) => void,
    ) {
        if (!IS_CLIENT) {
            // On server, execute locally
            localCall("server");
            return;
        }

        // On client: use SABBridge if available, otherwise HTTP bridge
        if (!this.sabBridge) {
            // HTTP bridge fallback - serialize the flow node before sending
            const serializePlugin = (globalThis as any).__fxPlugins?.serialize;
            let serializedFlow = null;

            console.log('[FX-Flow] Attempting serialization...');
            console.log('[FX-Flow] serializePlugin available:', !!serializePlugin);
            console.log('[FX-Flow] this.haveSerialize:', this.haveSerialize);

            if (serializePlugin && this.haveSerialize) {
                try {
                    // Serialize the entire flow node
                    const flowNode = this.fx.resolvePath(flowPath, this.fx.root);
                    console.log('[FX-Flow] flowNode found:', !!flowNode);
                    console.log('[FX-Flow] flowPath:', flowPath);

                    if (flowNode) {
                        serializedFlow = serializePlugin.wrap(flowNode);
                        console.log('[FX-Flow] Serialization successful!');
                        this._log(npath, "info", ["serialized flow for server", flowPath]);
                    } else {
                        console.warn('[FX-Flow] flowNode not found for path:', flowPath);
                    }
                } catch (e: any) {
                    console.error('[FX-Flow] Serialization failed:', e);
                    this._log(npath, "warn", ["failed to serialize flow", String(e?.message || e)]);
                }
            } else {
                console.warn('[FX-Flow] Cannot serialize - plugin not available or flag not set');
            }

            // Use FX_SUSPEND for async HTTP call in main thread
            const fetchPromise = fetch('/fx/flow/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    flow: flowPath,
                    node: nodeName,
                    payload,
                    serializedFlow
                })
            })
            .then(res => res.json())
            .then(result => {
                if (result.ok) {
                    this._log(npath, "info", ["server ok via HTTP", result.result]);
                } else {
                    throw new Error(result.error);
                }
            })
            .catch(e => {
                this._log(npath, "error", ["server HTTP err", String(e?.message || e)]);
            });

            // Check if we're in main thread (browser context)
            if (typeof window !== "undefined" && typeof document !== "undefined") {
                // Throw FX_SUSPEND to handle async operation without blocking
                throw new (globalThis as any).FXSuspend(fetchPromise);
            }
            return;
        }
        // sync step via SAB; server executes same flow node effect and replies
        try {
            const res = this.sabBridge.call({
                kind: "step",
                flow: flowPath,
                node: nodeName,
                payload,
                traceId,
            });
            if (res.kind === "err") throw new Error(res.error);
            if (res.kind === "ok") {
                this._log(npath, "info", ["server ok", res.value]);
            }
        } catch (e: any) {
            this._log(npath, "error", ["server err", String(e?.message || e)]);
            // Fallback: attempt local execution to keep progress
            localCall("server");
        }
    }

    _log(npath: string, level: "info" | "warn" | "error", args: any[]) {
        const ringN = this.fx.resolvePath(`${npath}.logs.ring`, this.fx.root)!;
        const fullN = this.fx.resolvePath(`${npath}.logs.full`, this.fx.root)!;
        const defaults = (this.fx.val(
            this.fx.resolvePath("flows.__defaults", this.fx.root)!,
        ) || {}) as FlowConfig;
        const size = defaults.logSize || 128;

        const entry = { ts: Date.now(), level, args };
        const ring = (this.fx.val(ringN) as any[]) || [];
        if (ring.length >= size) ring.shift();
        ring.push(entry);
        this.fx.set(ringN, ring);

        const full = (this.fx.val(fullN) as any[]) || [];
        full.push(entry);
        this.fx.set(fullN, full);
    }

    private mountRoot() {
        this.fx.setPath("flows", {}, this.fx.root);
    }

    private installAPISurface() {
        // mount a callable surface: $$("flows.<name>").flow()
        const flowsNode = this.fx.resolvePath("flows", this.fx.root)!;
        const p = this.fx.createNodeProxy(flowsNode) as any;
        p.flow = (name?: string) => this.flow(name);
        (globalThis as any).$flow = (name?: string) => this.flow(name);
    }

    private autoloadDeps() {
        // Check if plugins object exists (not the proxy)
        const pluginsObj = (globalThis as any).__fxPlugins;

        // serialize (optional - only try to load if not already present)
        try {
            this.haveSerialize = !!(pluginsObj?.serialize);
        } catch { }
        // safe / time / db are optional
        try {
            this.haveSafe = !!(pluginsObj?.safe);
        } catch { }
        try {
            this.haveTime = !!(pluginsObj?.time);
        } catch { }
        try {
            this.haveDB = !!(globalThis as any).$db ||
                !!(pluginsObj?.orm);
        } catch { }
    }
}

// ---------- Flow handle (builder + runner) ----------
class FlowHandle implements FlowAPI {
    constructor(private core: FXFlowPlugin, private flowPath: string) { }

    node(name: string, def: NodeDef) {
        this.core._defineNode(this.flowPath, name, def);
        return this;
    }
    connect(from: string, ...to: string[]) {
        const root = this.core.getRoot();
        const ep = this.core.resolvePath(
            `${this.flowPath}.edges.${from}`,
            root
        ) ||
            this.core.setPath(
                `${this.flowPath}.edges.${from}`,
                [],
                root
            );
        const arr = (this.core.getValue(ep) as any[]) || [];
        for (const t of to) if (!arr.includes(t)) arr.push(t);
        this.core.setValue(ep, arr);
        return this;
    }
    start(firstNode: string, payload: any) {
        this.core._enqueue(this.flowPath, firstNode, payload);
        this.core._pump(this.flowPath);
        return this;
    }
    set(name: string, value: any) {
        const root = this.core.getRoot();
        this.core.setPath(
            `${this.flowPath}.nodes.${name}`,
            value,
            root
        );
        return this;
    }
    on(ev: OnEvent, cb: (e: any) => void) {
        return this.core.on(ev, cb);
    }
    off(ev: OnEvent, cb: (e: any) => void) {
        return this.core.off(ev, cb);
    }

    serialize() {
        return this.core.serialize(this.flowPath);
    }
    deserialize(snap: any) {
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

export interface FlowAPI {
    node(name: string, def: NodeDef): this;
    connect(from: string, ...to: string[]): this;
    start(firstNode: string, payload: any): this;
    set(name: string, value: any): this;
    on(ev: OnEvent, cb: (e: any) => void): () => void;
    off(ev: OnEvent, cb: (e: any) => void): void;
    serialize(): any;
    deserialize(snap: any): this;
    runSync(maxSteps?: number): this;
}

// ---------- Realm / SAB bridge helpers ----------
const IS_SERVER = typeof (globalThis as any).Deno !== "undefined";
const IS_CLIENT = !IS_SERVER;

function realm(): RunTarget {
    return IS_SERVER ? "server" : "client";
}

// Minimal SAB/Atomics request/response bridge for server steps
class SABBridge {
    private worker: Worker | null = null;
    private sab: SharedArrayBuffer;
    private lock: Int32Array;
    private len: Int32Array;
    private buf: Uint8Array;

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

    call(msg: SABMessage): SABMessage {
        const id = Math.floor(Math.random() * 1e9);
        Atomics.store(this.lock, 0, 0);
        this.worker!.postMessage({ id, sab: this.sab, payload: msg });
        // Check if we're in a browser main thread context (not in a worker)
        if (typeof window !== "undefined" && typeof document !== "undefined") {
            const p = Promise.resolve(); // resume next frame
            // @ts-ignore
            throw new (globalThis as any).FXSuspend(p);
        }

        const result = Atomics.wait(this.lock, 0, 0, 15000);
        if (result === "timed-out") throw new Error("SABBridge timeout");
        const signal = Atomics.load(this.lock, 0);
        if (signal !== id) throw new Error("Bridge error / buffer too small");
        const n = this.len[0];
        const text = new TextDecoder().decode(this.buf.subarray(0, n));
        try {
            return JSON.parse(text) as SABMessage;
        } catch {
            return { kind: "err", error: "Invalid JSON from server" };
        }
    }
}
