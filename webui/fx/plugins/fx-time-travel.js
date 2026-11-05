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
  FXTimeTravelPlugin: () => FXTimeTravelPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class FXTimeTravelPlugin {
  name = "time";
  version = "1.1.0";
  description = "Time travel for FX nodes";
  fx;
  currentTimeline = "main";
  timelines = /* @__PURE__ */ new Map();
  currentIndex = 0;
  constructor(fx, opts = {}) {
    this.fx = fx;
    this.timelines.set("main", [this._makeSnapshot("Initial")]);
  }
  install = (fx) => void 0;
  snapshot(description = "Manual") {
    const snap = this._makeSnapshot(description);
    const line = this.timelines.get(this.currentTimeline);
    line.push(snap);
    this.currentIndex = line.length - 1;
    return snap;
  }
  undo(steps = 1) {
    const line = this.timelines.get(this.currentTimeline);
    const idx = Math.max(0, this.currentIndex - steps);
    if (idx !== this.currentIndex) {
      this._restore(line[idx]);
      this.currentIndex = idx;
    }
  }
  redo(steps = 1) {
    const line = this.timelines.get(this.currentTimeline);
    const idx = Math.min(line.length - 1, this.currentIndex + steps);
    if (idx !== this.currentIndex) {
      this._restore(line[idx]);
      this.currentIndex = idx;
    }
  }
  branch(name, fn) {
    const base = this._current();
    const branchLine = [base];
    this.timelines.set(name, branchLine);
    const prev = this.currentTimeline;
    this.currentTimeline = name;
    this.currentIndex = 0;
    try {
      fn();
      this.snapshot(`Post-branch ${name}`);
    } finally {
      this.currentTimeline = prev;
      this.currentIndex = this.timelines.get(prev).length - 1;
    }
    return { return: () => {
      this.currentTimeline = prev;
    } };
  }
  compare(a, b) {
    const A = this.timelines.get(a)?.at(-1)?.state;
    const B = this.timelines.get(b)?.at(-1)?.state;
    if (!A || !B) throw new Error("Invalid timelines");
    return this._diff(A, B);
  }
  /** FUTURE placeholder: returns a proxy with sync getters while resolving async internally */
  future(path, compute) {
    const key = `time.future.${path.replace(/\./g, "_")}`;
    setTimeout(() => {
      try {
        const value = compute();
        if (typeof globalThis.$$ === "function") {
          globalThis.$$(key + ".value").val(value);
          globalThis.$$(key + ".resolved").val(true);
        } else {
          this.fx.setPath(key + ".value", value, this.fx.root);
          this.fx.setPath(key + ".resolved", true, this.fx.root);
        }
      } catch (e) {
        this.fx.setPath(key + ".error", String(e?.message || e), this.fx.root);
      }
    }, 0);
    const handler = {
      get: (_t, prop) => {
        if (prop === "then") {
          return (cb) => {
            const poll = () => {
              const r = typeof globalThis.$$ === "function" ? globalThis.$$(key + ".resolved").val() : this.fx.getPath(key + ".resolved", this.fx.root)?.__value;
              if (r) {
                const v = typeof globalThis.$$ === "function" ? globalThis.$$(key + ".value").val() : this.fx.getPath(key + ".value", this.fx.root)?.__value;
                cb(v);
              } else setTimeout(poll, 8);
            };
            poll();
          };
        }
        return this.future(path + "." + String(prop), () => {
          const v = typeof globalThis.$$ === "function" ? globalThis.$$(key + ".value").val() : this.fx.getPath(key + ".value", this.fx.root)?.__value;
          return v?.[prop];
        });
      }
    };
    return new Proxy({ __isFuture: true }, handler);
  }
  // ---- internals ----
  _current() {
    const line = this.timelines.get(this.currentTimeline);
    return line[this.currentIndex];
  }
  _makeSnapshot(description) {
    return {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      timestamp: Date.now(),
      timeline: this.currentTimeline,
      state: this._serialize(this.fx.root)
    };
  }
  _serialize(node) {
    const kids = {};
    const entries = node.__nodes ? Object.entries(node.__nodes) : [];
    for (const [k, child] of entries) kids[k] = this._serialize(child);
    const out = {
      __id: node.__id,
      __type: node.__type,
      __value: this._clone(node.__value),
      __nodes: kids
    };
    return out;
  }
  _restore(snap) {
    const apply = (dst, src) => {
      this.fx.set(dst, this._clone(src.__value));
      const keys = /* @__PURE__ */ new Set([
        ...Object.keys(dst.__nodes || {}),
        ...Object.keys(src.__nodes || {})
      ]);
      for (const k of keys) {
        const d = dst.__nodes?.[k];
        const s = src.__nodes?.[k];
        if (d && s) apply(d, s);
      }
    };
    apply(this.fx.root, snap.state);
  }
  _clone(v) {
    if (v === null || typeof v !== "object") return v;
    try {
      return structuredClone(v);
    } catch {
      return JSON.parse(JSON.stringify(v));
    }
  }
  _diff(a, b, path = "root", acc = []) {
    if (JSON.stringify(a.__value) !== JSON.stringify(b.__value)) {
      acc.push({ path, a: a.__value, b: b.__value });
    }
    const keys = /* @__PURE__ */ new Set([...Object.keys(a.__nodes), ...Object.keys(b.__nodes)]);
    for (const k of keys) {
      const ak = a.__nodes[k], bk = b.__nodes[k];
      if (ak && bk) this._diff(ak, bk, path + "." + k, acc);
      else acc.push({ path: path + "." + k, a: !!ak ? "[exists]" : "[missing]", b: !!bk ? "[exists]" : "[missing]" });
    }
    return acc;
  }
}
var stdin_default = FXTimeTravelPlugin;
