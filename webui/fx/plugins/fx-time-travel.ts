/**
 * @fx-plugin fx-time-travel
 * @fx-global $time
 * @fx-description State snapshots and debugging with rollback capabilities
 * @fx-dependencies
 * @fx-provides $time
 * @fx-version 1.0.0
 *
 * fx-time-travel.ts — TypeScript port + enhancements
 * - Snapshots, undo/redo, branching, comparison
 * - "Future" placeholders with sync API surface
 */
import type { FX, FXNode, FXPlugin } from "./fx-types";

type Snapshot = {
  id: string;
  description: string;
  timestamp: number;
  timeline: string;
  state: SerializedNode;
  meta?: Record<string, any>;
};

type SerializedNode = {
  __id: string;
  __type?: string;
  __value?: any;
  __nodes: Record<string, SerializedNode>;
};

export class FXTimeTravelPlugin implements FXPlugin {
  public name = "time";
  public version = "1.1.0";
  public description = "Time travel for FX nodes";

  private fx: FX;
  private currentTimeline = "main";
  private timelines = new Map<string, Snapshot[]>();
  private currentIndex = 0;

  constructor(fx: FX, opts: Partial<{ maxHistorySize: number }> = {}) {
    this.fx = fx;
    // init main timeline
    this.timelines.set("main", [this._makeSnapshot("Initial")]);
  }

  install = (fx: FX) => void 0;

  snapshot(description = "Manual"): Snapshot {
    const snap = this._makeSnapshot(description);
    const line = this.timelines.get(this.currentTimeline)!;
    line.push(snap);
    this.currentIndex = line.length - 1;
    return snap;
  }

  undo(steps = 1): void {
    const line = this.timelines.get(this.currentTimeline)!;
    const idx = Math.max(0, this.currentIndex - steps);
    if (idx !== this.currentIndex) {
      this._restore(line[idx]);
      this.currentIndex = idx;
    }
  }

  redo(steps = 1): void {
    const line = this.timelines.get(this.currentTimeline)!;
    const idx = Math.min(line.length - 1, this.currentIndex + steps);
    if (idx !== this.currentIndex) {
      this._restore(line[idx]);
      this.currentIndex = idx;
    }
  }

  branch(name: string, fn: () => void): { return: () => void } {
    const base = this._current();
    const branchLine: Snapshot[] = [base];
    this.timelines.set(name, branchLine);
    const prev = this.currentTimeline;
    this.currentTimeline = name;
    this.currentIndex = 0;
    try {
      fn();
      this.snapshot(`Post-branch ${name}`);
    } finally {
      this.currentTimeline = prev;
      this.currentIndex = this.timelines.get(prev)!.length - 1;
    }
    return { return: () => { this.currentTimeline = prev; } };
  }

  compare(a: string, b: string) {
    const A = this.timelines.get(a)?.at(-1)?.state;
    const B = this.timelines.get(b)?.at(-1)?.state;
    if (!A || !B) throw new Error("Invalid timelines");
    return this._diff(A, B);
  }

  /** FUTURE placeholder: returns a proxy with sync getters while resolving async internally */
  future<T>(path: string, compute: () => T): T & { __isFuture: true } {
    const key = `time.future.${path.replace(/\./g, "_")}`;
    // schedule resolution
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
      } catch (e: any) {
        this.fx.setPath(key + ".error", String(e?.message || e), this.fx.root);
      }
    }, 0);

    const handler: ProxyHandler<any> = {
      get: (_t, prop) => {
        // expose then() to mimic promises
        if (prop === "then") {
          return (cb: (v: T) => void) => {
            const poll = () => {
              const r = (typeof globalThis.$$ === "function"
                ? globalThis.$$(key + ".resolved").val()
                : this.fx.getPath(key + ".resolved", this.fx.root)?.__value);
              if (r) {
                const v = (typeof globalThis.$$ === "function"
                  ? globalThis.$$(key + ".value").val()
                  : this.fx.getPath(key + ".value", this.fx.root)?.__value);
                cb(v as T);
              } else setTimeout(poll, 8);
            };
            poll();
          };
        }
        // any other property access triggers nested future
        return this.future(path + "." + String(prop), () => {
          const v = (typeof globalThis.$$ === "function"
            ? globalThis.$$(key + ".value").val()
            : this.fx.getPath(key + ".value", this.fx.root)?.__value);
          return (v as any)?.[prop as any];
        });
      }
    };
    return new Proxy({ __isFuture: true } as any, handler);
  }

  // ---- internals ----
  private _current(): Snapshot {
    const line = this.timelines.get(this.currentTimeline)!;
    return line[this.currentIndex];
    }

  private _makeSnapshot(description: string): Snapshot {
    return {
      id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      description,
      timestamp: Date.now(),
      timeline: this.currentTimeline,
      state: this._serialize(this.fx.root),
    };
  }

  private _serialize(node: FXNode): SerializedNode {
    const kids: Record<string, SerializedNode> = {};
    const entries = node.__nodes ? Object.entries(node.__nodes) : [];
    for (const [k, child] of entries) kids[k] = this._serialize(child);
    const out: SerializedNode = {
      __id: node.__id,
      __type: node.__type,
      __value: this._clone(node.__value),
      __nodes: kids
    };
    return out;
  }

  private _restore(snap: Snapshot) {
    // simple deep copy back into fx tree (expects stable shape)
    const apply = (dst: FXNode, src: SerializedNode) => {
      this.fx.set(dst, this._clone(src.__value));
      const keys = new Set([
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

  private _clone<T>(v: T): T {
    if (v === null || typeof v !== "object") return v;
    try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); }
  }

  private _diff(a: SerializedNode, b: SerializedNode, path = "root", acc: any[] = []) {
    if (JSON.stringify(a.__value) !== JSON.stringify(b.__value)) {
      acc.push({ path, a: a.__value, b: b.__value });
    }
    const keys = new Set([...Object.keys(a.__nodes), ...Object.keys(b.__nodes)]);
    for (const k of keys) {
      const ak = a.__nodes[k], bk = b.__nodes[k];
      if (ak && bk) this._diff(ak, bk, path + "." + k, acc);
      else acc.push({ path: path + "." + k, a: !!ak ? "[exists]" : "[missing]", b: !!bk ? "[exists]" : "[missing]" });
    }
    return acc;
  }
}

export default FXTimeTravelPlugin;
