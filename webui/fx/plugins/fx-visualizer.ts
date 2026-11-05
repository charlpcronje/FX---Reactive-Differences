/**
 * @fx-plugin fx-visualizer
 * @fx-global $visualizer
 * @fx-description Live node graph visualization with D3.js
 * @fx-dependencies
 * @fx-provides $visualizer
 * @fx-version 1.0.0
 *
 * fx-visualizer.ts — TypeScript port (keeps API sync)
 * D3 is optional; declare as any to avoid bundler issues if absent
 */
import type { FX, FXNode, FXPlugin } from "./fx-types";
declare const d3: any;

type NodeData = {
  id: string;
  path: string;
  fxNode: FXNode;
  type: string;
  color: string;
  watchers: any[];
  hasDOM: boolean;
  x?: number; y?: number;
  domElement?: HTMLElement | null;
};

export class FXVisualizerPlugin implements FXPlugin {
  public name = "visualizer";
  public version = "1.1.0";
  public description = "Live FX node graph visualization";
  private fx: FX;

  private overlay?: HTMLDivElement;
  private svg?: any;
  private nodes: NodeData[] = [];
  private links: { source: string; target: string; type: string }[] = [];
  private nodeMap = new Map<string, NodeData>();
  private isVisible = false;

  constructor(fx: FX, opts: Partial<{ hotkey: string }> = {}) {
    this.fx = fx;
    this._initUI(opts.hotkey || "Ctrl+Shift+F");
    this._scan();
  }

  install = (fx: FX) => void 0;

  toggle() { this.isVisible ? this.hide() : this.show(); }
  show() { if (this.overlay) { this.overlay.style.display = "block"; this.isVisible = true; this._render(); } }
  hide() { if (this.overlay) { this.overlay.style.display = "none"; this.isVisible = false; } }

  private _initUI(hotkey: string) {
    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position: "fixed", inset: "20px", zIndex: "10000",
      background: "rgba(0,0,0,.9)", border: "1px solid #374151", borderRadius: "12px",
      display: "none"
    });
    const close = document.createElement("button");
    close.textContent = "×";
    Object.assign(close.style, { position: "absolute", top: "10px", right: "10px" });
    close.onclick = () => this.hide();
    const canvas = document.createElement("div");
    canvas.style.cssText = "width:100%;height:100%";
    this.overlay.appendChild(close);
    this.overlay.appendChild(canvas);
    document.body.appendChild(this.overlay);

    // SVG root
    if (typeof d3 !== "undefined") {
      this.svg = d3.select(canvas).append("svg").attr("width", "100%").attr("height", "100%").append("g");
    }

    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === hotkey.split("+").pop()?.toUpperCase()) {
        e.preventDefault();
        this.toggle();
      }
    });
  }

  private _scan() {
    this.nodes = [];
    this.links = [];
    this.nodeMap.clear();
    const traverse = (n: FXNode, path = "root") => {
      const data: NodeData = {
        id: path, path, fxNode: n,
        type: this._type(n),
        color: this._color(n),
        watchers: (n as any).__watchers ? Array.from((n as any).__watchers) : [],
        hasDOM: !!this._dom(n),
        x: Math.random() * 800, y: Math.random() * 600
      };
      this.nodes.push(data); this.nodeMap.set(path, data);
      const entries = n.__nodes ? Object.entries(n.__nodes) : [];
      for (const [k, c] of entries) {
        const childPath = path === "root" ? k : `${path}.${k}`;
        traverse(c, childPath);
        this.links.push({ source: path, target: childPath, type: "hierarchy" });
      }
    };
    traverse(this.fx.root);
  }

  private _render() {
    if (!this.svg || typeof d3 === "undefined") return;
    const nodes = this.nodes, links = this.links;
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d: any) => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(400, 300));

    const linkSel = this.svg.selectAll("line").data(links);
    linkSel.enter().append("line").merge(linkSel).attr("stroke", "#6b7280");
    const nodeSel = this.svg.selectAll("circle").data(nodes);
    nodeSel.enter().append("circle").attr("r", 6).merge(nodeSel)
      .attr("fill", (d: NodeData) => d.color)
      .call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended))
      .on("click", (_: any, d: NodeData) => console.log("FX node", d.path, d));

    sim.on("tick", () => {
      linkSel
        .attr("x1", (d: any) => pos(d.source.x, 800))
        .attr("y1", (d: any) => pos(d.source.y, 600))
        .attr("x2", (d: any) => pos(d.target.x, 800))
        .attr("y2", (d: any) => pos(d.target.y, 600));
      nodeSel
        .attr("cx", (d: any) => pos(d.x, 800))
        .attr("cy", (d: any) => pos(d.y, 600));
    });

    function pos(v: number, max: number) { return Math.max(0, Math.min(max, v || 0)); }
    function dragstarted(event: any) { if (!event.active) sim.alphaTarget(0.3).restart(); event.subject.fx = event.subject.x; event.subject.fy = event.subject.y; }
    function dragged(event: any) { event.subject.fx = event.x; event.subject.fy = event.y; }
    function dragended(event: any) { if (!event.active) sim.alphaTarget(0); event.subject.fx = null; event.subject.fy = null; }
  }

  private _type(n: FXNode): string {
    if (n.__type) return n.__type;
    if (typeof n.__value === "function") return "function";
    if (n.__value !== undefined && ["string", "number", "boolean"].includes(typeof n.__value)) return "primitive";
    return "json";
  }
  private _color(n: FXNode): string {
    const t = this._type(n);
    return ({ json: "#3b82f6", function: "#ec4899", primitive: "#f59e0b" } as any)[t] || "#64748b";
  }
  private _dom(n: FXNode): HTMLElement | null {
    const inst = (n as any).__instances;
    if (!inst) return null;
    for (const i of inst.values?.() || []) if (i?._element instanceof HTMLElement) return i._element;
    return null;
  }
}

export default FXVisualizerPlugin;
