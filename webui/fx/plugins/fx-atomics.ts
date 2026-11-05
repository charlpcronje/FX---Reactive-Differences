/**
 * fx-atomics.v3.ts — Entangled node syncing with lifecycle hooks & controls
 *
 * Highlights
 * - beforeSet → set → afterSet hooks per side (A/B)
 * - Bi‑directional or one‑way propagation with transforms
 * - Re‑entrancy guard (no ping‑pong), equality checks
 * - Microtask coalescing (avoid thrash on sync bursts)
 * - Pause/Resume/Dispose controls per link
 * - Minimal assumptions about your FX runtime:
 *     - fx.resolvePath(path, root) -> FXNode
 *     - fx.root: FXNode
 *     - fx.val(node) -> any
 *     - fx.set(node, value): void
 *
 * This is drop‑in as a plugin class implementing FXPlugin.
 * If your existing plugin name/class collides, rename before use.
 */

// You can adjust these imports to your local type locations:
import type { FX, FXNode, FXPlugin } from "./fx-types";

type NodeRef = string | FXNode;

type Source = 'local' | 'propagation';
type Side = 'A' | 'B';

export type HookResult<T> =
  | { action: 'proceed'; value: T }
  | { action: 'skip' }
  | { action: 'redirect'; to: Side; value: any };

export type BeforeSetHook<T> = (args: {
  side: Side;
  incoming: T;          // value arriving at this side
  current: T;           // current value at this side
  source: Source;
  meta?: Record<string, unknown>;
}) => HookResult<T> | void;

export type SetHook<T> = (args: {
  side: Side;
  value: T;             // value about to be committed at this side
  source: Source;
  meta?: Record<string, unknown>;
}) => HookResult<T> | void;

export type AfterSetHook<T> = (args: {
  side: Side;
  value: T;             // value committed at this side
  source: Source;
  durationMs: number;
  meta?: Record<string, unknown>;
}) => void;

export interface AtomicOptions<A = any, B = any> {
  // Direction
  bidirectional?: boolean;       // default true
  oneWayAToB?: boolean;          // if true, only A->B
  oneWayBToA?: boolean;          // if true, only B->A

  // Initial sync
  syncInitialValue?: boolean;    // default true: push current A (or B in one-way)

  // Transforms
  mapAToB?: (a: A) => B;
  mapBToA?: (b: B) => A;

  // Equality
  equalsA?: (x: A, y: A) => boolean;
  equalsB?: (x: B, y: B) => boolean;

  // Hooks per side
  hooksA?: {
    beforeSet?: BeforeSetHook<A> | BeforeSetHook<A>[];
    set?: SetHook<A> | SetHook<A>[];
    afterSet?: AfterSetHook<A> | AfterSetHook<A>[];
  };
  hooksB?: {
    beforeSet?: BeforeSetHook<B> | BeforeSetHook<B>[];
    set?: SetHook<B> | SetHook<B>[];
    afterSet?: AfterSetHook<B> | AfterSetHook<B>[];
  };

  // Misc
  swallowHookErrors?: boolean;   // default true
  meta?: Record<string, unknown>;
  label?: string;                // for logs
}

function arrify<T>(x?: T | T[]): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

function defaultEq<T>(x: T, y: T) { return Object.is(x, y); }

/** A single entanglement link instance with runtime controls. */
export interface AtomicLink {
  pause(): void;
  resume(): void;
  dispose(): void;
  isPaused(): boolean;

  onA(h: {
    beforeSet?: BeforeSetHook<any> | BeforeSetHook<any>[];
    set?: SetHook<any> | SetHook<any>[];
    afterSet?: AfterSetHook<any> | AfterSetHook<any>[];
  }): void;

  onB(h: {
    beforeSet?: BeforeSetHook<any> | BeforeSetHook<any>[];
    set?: SetHook<any> | SetHook<any>[];
    afterSet?: AfterSetHook<any> | AfterSetHook<any>[];
  }): void;
}

export class FXAtomicsPlugin implements FXPlugin {
  public name = "atomics";
  public version = "2.0.0";
  public description = "Entangled nodes with lifecycle hooks and deterministic propagation";

  constructor(private fx: FX) {}

  /** Create an entanglement between two nodes */
  entangle<A = any, B = any>(a: NodeRef, b: NodeRef, opts: AtomicOptions<A, B> = {}): AtomicLink {
    const A = this._node(a);
    const B = this._node(b);
    if (!A || !B) throw new Error("FXAtomics.entangle: node(s) not found");

    const equalsA = opts.equalsA ?? defaultEq<A>;
    const equalsB = opts.equalsB ?? defaultEq<B>;
    const bidir = opts.bidirectional !== false && !opts.oneWayAToB && !opts.oneWayBToA;
    const swallow = opts.swallowHookErrors ?? true;
    const syncInitial = opts.syncInitialValue !== false;
    const meta = opts.meta ?? {};

    const hooksA = {
      before: arrify(opts.hooksA?.beforeSet),
      set:    arrify(opts.hooksA?.set),
      after:  arrify(opts.hooksA?.afterSet),
    };
    const hooksB = {
      before: arrify(opts.hooksB?.beforeSet),
      set:    arrify(opts.hooksB?.set),
      after:  arrify(opts.hooksB?.afterSet),
    };

    let paused = false;
    let phase: 'idle' | 'pushingAtoB' | 'pushingBtoA' = 'idle';

    // Burst coalescing
    let pendingA: A | undefined;
    let pendingB: B | undefined;
    let scheduled = false;

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (paused) { pendingA = undefined; pendingB = undefined; return; }
        if (pendingA !== undefined && (bidir || !opts.oneWayBToA)) {
          const a = pendingA as A; pendingA = undefined;
          pushAtoB(a, 'propagation');
        }
        if (pendingB !== undefined && (bidir || !opts.oneWayAToB)) {
          const b = pendingB as B; pendingB = undefined;
          pushBtoA(b, 'propagation');
        }
      });
    };

    const runBefore = <T>(side: Side, incoming: T, current: T, source: Source) => {
      const list = side === 'A' ? hooksA.before as BeforeSetHook<T>[] : (hooksB.before as BeforeSetHook<T>[]);
      let val: T = incoming;
      for (const fn of list) {
        try {
          const r = fn({ side, incoming: val, current, source, meta });
          if (!r) continue;
          if (r.action === 'skip') return r;
          if (r.action === 'redirect') return r;
          if (r.action === 'proceed') val = r.value as T;
        } catch (e) {
          if (!swallow) throw e;
          // swallow
        }
      }
      return { action: 'proceed', value: val } as HookResult<T>;
    };

    const runSet = <T>(side: Side, value: T, source: Source) => {
      const list = side === 'A' ? hooksA.set as SetHook<T>[] : (hooksB.set as SetHook<T>[]);
      let val: T = value;
      for (const fn of list) {
        try {
          const r = fn({ side, value: val, source, meta });
          if (!r) continue;
          if (r.action === 'skip') return r;
          if (r.action === 'redirect') return r;
          if (r.action === 'proceed') val = r.value as T;
        } catch (e) {
          if (!swallow) throw e;
        }
      }
      return { action: 'proceed', value: val } as HookResult<T>;
    };

    const runAfter = <T>(side: Side, value: T, source: Source, durationMs: number) => {
      const list = side === 'A' ? hooksA.after as AfterSetHook<T>[] : (hooksB.after as AfterSetHook<T>[]);
      for (const fn of list) {
        try { fn({ side, value, source, durationMs, meta }); } catch (e) { if (!swallow) throw e; }
      }
    };

    const mapAToB = opts.mapAToB ?? ((a: A) => a as unknown as B);
    const mapBToA = opts.mapBToA ?? ((b: B) => b as unknown as A);

    const pushAtoB = (a: A, source: Source) => {
      if (paused || phase !== 'idle') return;
      const mapped = mapAToB(a);
      const before = runBefore<B>('B', mapped as B, this.fx.val(B), source);
      if (!before || before.action === 'skip') return;
      if (before.action === 'redirect') {
        if (before.to === 'A') pushBtoA(before.value as B, 'propagation');
        return;
      }
      const setR = runSet<B>('B', before.value as B, source);
      if (!setR || setR.action === 'skip') return;
      if (setR.action === 'redirect') {
        if (setR.to === 'A') pushBtoA(setR.value as B, 'propagation');
        return;
      }
      const nextB = setR.value as B;
      const curB = this.fx.val(B);
      if (equalsB(nextB as any, curB as any)) return;
      const t0 = performance.now?.() ?? Date.now();
      phase = 'pushingAtoB';
      try { this.fx.set(B, nextB); }
      finally {
        phase = 'idle';
        const t1 = performance.now?.() ?? Date.now();
        runAfter<B>('B', nextB, source, (t1 as number) - (t0 as number));
      }
    };

    const pushBtoA = (b: B, source: Source) => {
      if (paused || phase !== 'idle') return;
      const mapped = mapBToA(b);
      const before = runBefore<A>('A', mapped as A, this.fx.val(A), source);
      if (!before || before.action === 'skip') return;
      if (before.action === 'redirect') {
        if (before.to === 'B') pushAtoB(before.value as A, 'propagation');
        return;
      }
      const setR = runSet<A>('A', before.value as A, source);
      if (!setR || setR.action === 'skip') return;
      if (setR.action === 'redirect') {
        if (setR.to === 'B') pushAtoB(setR.value as A, 'propagation');
        return;
      }
      const nextA = setR.value as A;
      const curA = this.fx.val(A);
      if (equalsA(nextA as any, curA as any)) return;
      const t0 = performance.now?.() ?? Date.now();
      phase = 'pushingBtoA';
      try { this.fx.set(A, nextA); }
      finally {
        phase = 'idle';
        const t1 = performance.now?.() ?? Date.now();
        runAfter<A>('A', nextA, source, (t1 as number) - (t0 as number));
      }
    };

    // Wrap local writes by intercepting "local set" calls
    // If your FX runtime allows a value property trap, you can adapt here.
    const localSetA = (v: A) => {
      if (paused) { this.fx.set(A, v); return; }
      if (phase === 'pushingBtoA') { this.fx.set(A, v); return; }
      const before = runBefore<A>('A', v, this.fx.val(A), 'local');
      if (!before || before.action === 'skip') return;
      if (before.action === 'redirect') {
        if (before.to === 'B') pushAtoB(before.value as A, 'local'); return;
      }
      const setR = runSet<A>('A', before.value as A, 'local');
      if (!setR || setR.action === 'skip') return;
      if (setR.action === 'redirect') {
        if (setR.to === 'B') pushAtoB(setR.value as A, 'local'); return;
      }
      const final = setR.value as A;
      const cur = this.fx.val(A);
      if (equalsA(final as any, cur as any)) return;
      const t0 = performance.now?.() ?? Date.now();
      this.fx.set(A, final);
      const t1 = performance.now?.() ?? Date.now();
      runAfter<A>('A', final, 'local', (t1 as number) - (t0 as number));

      if (bidir || !opts.oneWayBToA) { pendingA = final; schedule(); }
    };

    const localSetB = (v: B) => {
      if (paused) { this.fx.set(B, v); return; }
      if (phase === 'pushingAtoB') { this.fx.set(B, v); return; }
      const before = runBefore<B>('B', v, this.fx.val(B), 'local');
      if (!before || before.action === 'skip') return;
      if (before.action === 'redirect') {
        if (before.to === 'A') pushBtoA(before.value as B, 'local'); return;
      }
      const setR = runSet<B>('B', before.value as B, 'local');
      if (!setR || setR.action === 'skip') return;
      if (setR.action === 'redirect') {
        if (setR.to === 'A') pushBtoA(setR.value as B, 'local'); return;
      }
      const final = setR.value as B;
      const cur = this.fx.val(B);
      if (equalsB(final as any, cur as any)) return;
      const t0 = performance.now?.() ?? Date.now();
      this.fx.set(B, final);
      const t1 = performance.now?.() ?? Date.now();
      runAfter<B>('B', final, 'local', (t1 as number) - (t0 as number));

      if (bidir || !opts.oneWayAToB) { pendingB = final; schedule(); }
    };

    // Public controls + hook appenders
    const link: AtomicLink = {
      pause: () => { paused = true; pendingA = undefined; pendingB = undefined; },
      resume: () => {
        paused = false;
        if (!syncInitial) return;
        // re-sync with current values when resuming
        if (bidir || !opts.oneWayBToA) { pendingA = this.fx.val(A); }
        if (bidir || !opts.oneWayAToB) { pendingB = this.fx.val(B); }
        schedule();
      },
      dispose: () => { paused = true; pendingA = undefined; pendingB = undefined; },
      isPaused: () => paused,
      onA: (h) => {
        if (h.beforeSet) hooksA.before.push(...arrify(h.beforeSet));
        if (h.set)       hooksA.set.push(...arrify(h.set));
        if (h.afterSet)  hooksA.after.push(...arrify(h.afterSet));
      },
      onB: (h) => {
        if (h.beforeSet) hooksB.before.push(...arrify(h.beforeSet));
        if (h.set)       hooksB.set.push(...arrify(h.set));
        if (h.afterSet)  hooksB.after.push(...arrify(h.afterSet));
      }
    };

    // Initial reconciliation
    if (syncInitial) {
      if (bidir || !opts.oneWayBToA) { pendingA = this.fx.val(A); }
      if (bidir || !opts.oneWayAToB) { pendingB = this.fx.val(B); }
      schedule();
    }

    // Return link plus local setters so the caller can wire traps to their FX layer if desired
    // Usage suggestion:
    //   $$('pathA').effect('value', (v) => linkLocalA(v));
    //   $$('pathB').effect('value', (v) => linkLocalB(v));
    (link as any).__localSetA = localSetA;
    (link as any).__localSetB = localSetB;

    return link;
  }

  // --- helpers ---
  private _node(n: NodeRef): FXNode | null {
    return typeof n === "string" ? this.fx.resolvePath(n, this.fx.root) : n;
  }
}

export default FXAtomicsPlugin;
