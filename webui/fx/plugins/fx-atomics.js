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
  FXAtomicsPlugin: () => FXAtomicsPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
function arrify(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}
function defaultEq(x, y) {
  return Object.is(x, y);
}
class FXAtomicsPlugin {
  constructor(fx) {
    this.fx = fx;
  }
  name = "atomics";
  version = "2.0.0";
  description = "Entangled nodes with lifecycle hooks and deterministic propagation";
  /** Create an entanglement between two nodes */
  entangle(a, b, opts = {}) {
    const A = this._node(a);
    const B = this._node(b);
    if (!A || !B) throw new Error("FXAtomics.entangle: node(s) not found");
    const equalsA = opts.equalsA ?? defaultEq;
    const equalsB = opts.equalsB ?? defaultEq;
    const bidir = opts.bidirectional !== false && !opts.oneWayAToB && !opts.oneWayBToA;
    const swallow = opts.swallowHookErrors ?? true;
    const syncInitial = opts.syncInitialValue !== false;
    const meta = opts.meta ?? {};
    const hooksA = {
      before: arrify(opts.hooksA?.beforeSet),
      set: arrify(opts.hooksA?.set),
      after: arrify(opts.hooksA?.afterSet)
    };
    const hooksB = {
      before: arrify(opts.hooksB?.beforeSet),
      set: arrify(opts.hooksB?.set),
      after: arrify(opts.hooksB?.afterSet)
    };
    let paused = false;
    let phase = "idle";
    let pendingA;
    let pendingB;
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (paused) {
          pendingA = void 0;
          pendingB = void 0;
          return;
        }
        if (pendingA !== void 0 && (bidir || !opts.oneWayBToA)) {
          const a2 = pendingA;
          pendingA = void 0;
          pushAtoB(a2, "propagation");
        }
        if (pendingB !== void 0 && (bidir || !opts.oneWayAToB)) {
          const b2 = pendingB;
          pendingB = void 0;
          pushBtoA(b2, "propagation");
        }
      });
    };
    const runBefore = (side, incoming, current, source) => {
      const list = side === "A" ? hooksA.before : hooksB.before;
      let val = incoming;
      for (const fn of list) {
        try {
          const r = fn({ side, incoming: val, current, source, meta });
          if (!r) continue;
          if (r.action === "skip") return r;
          if (r.action === "redirect") return r;
          if (r.action === "proceed") val = r.value;
        } catch (e) {
          if (!swallow) throw e;
        }
      }
      return { action: "proceed", value: val };
    };
    const runSet = (side, value, source) => {
      const list = side === "A" ? hooksA.set : hooksB.set;
      let val = value;
      for (const fn of list) {
        try {
          const r = fn({ side, value: val, source, meta });
          if (!r) continue;
          if (r.action === "skip") return r;
          if (r.action === "redirect") return r;
          if (r.action === "proceed") val = r.value;
        } catch (e) {
          if (!swallow) throw e;
        }
      }
      return { action: "proceed", value: val };
    };
    const runAfter = (side, value, source, durationMs) => {
      const list = side === "A" ? hooksA.after : hooksB.after;
      for (const fn of list) {
        try {
          fn({ side, value, source, durationMs, meta });
        } catch (e) {
          if (!swallow) throw e;
        }
      }
    };
    const mapAToB = opts.mapAToB ?? ((a2) => a2);
    const mapBToA = opts.mapBToA ?? ((b2) => b2);
    const pushAtoB = (a2, source) => {
      if (paused || phase !== "idle") return;
      const mapped = mapAToB(a2);
      const before = runBefore("B", mapped, this.fx.val(B), source);
      if (!before || before.action === "skip") return;
      if (before.action === "redirect") {
        if (before.to === "A") pushBtoA(before.value, "propagation");
        return;
      }
      const setR = runSet("B", before.value, source);
      if (!setR || setR.action === "skip") return;
      if (setR.action === "redirect") {
        if (setR.to === "A") pushBtoA(setR.value, "propagation");
        return;
      }
      const nextB = setR.value;
      const curB = this.fx.val(B);
      if (equalsB(nextB, curB)) return;
      const t0 = performance.now?.() ?? Date.now();
      phase = "pushingAtoB";
      try {
        this.fx.set(B, nextB);
      } finally {
        phase = "idle";
        const t1 = performance.now?.() ?? Date.now();
        runAfter("B", nextB, source, t1 - t0);
      }
    };
    const pushBtoA = (b2, source) => {
      if (paused || phase !== "idle") return;
      const mapped = mapBToA(b2);
      const before = runBefore("A", mapped, this.fx.val(A), source);
      if (!before || before.action === "skip") return;
      if (before.action === "redirect") {
        if (before.to === "B") pushAtoB(before.value, "propagation");
        return;
      }
      const setR = runSet("A", before.value, source);
      if (!setR || setR.action === "skip") return;
      if (setR.action === "redirect") {
        if (setR.to === "B") pushAtoB(setR.value, "propagation");
        return;
      }
      const nextA = setR.value;
      const curA = this.fx.val(A);
      if (equalsA(nextA, curA)) return;
      const t0 = performance.now?.() ?? Date.now();
      phase = "pushingBtoA";
      try {
        this.fx.set(A, nextA);
      } finally {
        phase = "idle";
        const t1 = performance.now?.() ?? Date.now();
        runAfter("A", nextA, source, t1 - t0);
      }
    };
    const localSetA = (v) => {
      if (paused) {
        this.fx.set(A, v);
        return;
      }
      if (phase === "pushingBtoA") {
        this.fx.set(A, v);
        return;
      }
      const before = runBefore("A", v, this.fx.val(A), "local");
      if (!before || before.action === "skip") return;
      if (before.action === "redirect") {
        if (before.to === "B") pushAtoB(before.value, "local");
        return;
      }
      const setR = runSet("A", before.value, "local");
      if (!setR || setR.action === "skip") return;
      if (setR.action === "redirect") {
        if (setR.to === "B") pushAtoB(setR.value, "local");
        return;
      }
      const final = setR.value;
      const cur = this.fx.val(A);
      if (equalsA(final, cur)) return;
      const t0 = performance.now?.() ?? Date.now();
      this.fx.set(A, final);
      const t1 = performance.now?.() ?? Date.now();
      runAfter("A", final, "local", t1 - t0);
      if (bidir || !opts.oneWayBToA) {
        pendingA = final;
        schedule();
      }
    };
    const localSetB = (v) => {
      if (paused) {
        this.fx.set(B, v);
        return;
      }
      if (phase === "pushingAtoB") {
        this.fx.set(B, v);
        return;
      }
      const before = runBefore("B", v, this.fx.val(B), "local");
      if (!before || before.action === "skip") return;
      if (before.action === "redirect") {
        if (before.to === "A") pushBtoA(before.value, "local");
        return;
      }
      const setR = runSet("B", before.value, "local");
      if (!setR || setR.action === "skip") return;
      if (setR.action === "redirect") {
        if (setR.to === "A") pushBtoA(setR.value, "local");
        return;
      }
      const final = setR.value;
      const cur = this.fx.val(B);
      if (equalsB(final, cur)) return;
      const t0 = performance.now?.() ?? Date.now();
      this.fx.set(B, final);
      const t1 = performance.now?.() ?? Date.now();
      runAfter("B", final, "local", t1 - t0);
      if (bidir || !opts.oneWayAToB) {
        pendingB = final;
        schedule();
      }
    };
    const link = {
      pause: () => {
        paused = true;
        pendingA = void 0;
        pendingB = void 0;
      },
      resume: () => {
        paused = false;
        if (!syncInitial) return;
        if (bidir || !opts.oneWayBToA) {
          pendingA = this.fx.val(A);
        }
        if (bidir || !opts.oneWayAToB) {
          pendingB = this.fx.val(B);
        }
        schedule();
      },
      dispose: () => {
        paused = true;
        pendingA = void 0;
        pendingB = void 0;
      },
      isPaused: () => paused,
      onA: (h) => {
        if (h.beforeSet) hooksA.before.push(...arrify(h.beforeSet));
        if (h.set) hooksA.set.push(...arrify(h.set));
        if (h.afterSet) hooksA.after.push(...arrify(h.afterSet));
      },
      onB: (h) => {
        if (h.beforeSet) hooksB.before.push(...arrify(h.beforeSet));
        if (h.set) hooksB.set.push(...arrify(h.set));
        if (h.afterSet) hooksB.after.push(...arrify(h.afterSet));
      }
    };
    if (syncInitial) {
      if (bidir || !opts.oneWayBToA) {
        pendingA = this.fx.val(A);
      }
      if (bidir || !opts.oneWayAToB) {
        pendingB = this.fx.val(B);
      }
      schedule();
    }
    link.__localSetA = localSetA;
    link.__localSetB = localSetB;
    return link;
  }
  // --- helpers ---
  _node(n) {
    return typeof n === "string" ? this.fx.resolvePath(n, this.fx.root) : n;
  }
}
var stdin_default = FXAtomicsPlugin;
