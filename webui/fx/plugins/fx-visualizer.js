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
  FXVisualizerPlugin: () => FXVisualizerPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class FXVisualizerPlugin {
  name = "visualizer";
  version = "1.1.0";
  description = "Live FX node graph visualization";
  fx;
  overlay;
  svg;
  nodes = [];
  links = [];
  nodeMap = /* @__PURE__ */ new Map();
  isVisible = false;
  constructor(fx, opts = {}) {
    this.fx = fx;
    this._initUI(opts.hotkey || "Ctrl+Shift+F");
    this._scan();
  }
  install = (fx) => void 0;
  toggle() {
    this.isVisible ? this.hide() : this.show();
  }
  show() {
    if (this.overlay) {
      this.overlay.style.display = "block";
      this.isVisible = true;
      this._render();
    }
  }
  hide() {
    if (this.overlay) {
      this.overlay.style.display = "none";
      this.isVisible = false;
    }
  }
  _initUI(hotkey) {
    this.overlay = document.createElement("div");
    Object.assign(this.overlay.style, {
      position: "fixed",
      inset: "20px",
      zIndex: "10000",
      background: "rgba(0,0,0,.9)",
      border: "1px solid #374151",
      borderRadius: "12px",
      display: "none"
    });
    const close = document.createElement("button");
    close.textContent = "\xD7";
    Object.assign(close.style, { position: "absolute", top: "10px", right: "10px" });
    close.onclick = () => this.hide();
    const canvas = document.createElement("div");
    canvas.style.cssText = "width:100%;height:100%";
    this.overlay.appendChild(close);
    this.overlay.appendChild(canvas);
    document.body.appendChild(this.overlay);
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
  _scan() {
    this.nodes = [];
    this.links = [];
    this.nodeMap.clear();
    const traverse = (n, path = "root") => {
      const data = {
        id: path,
        path,
        fxNode: n,
        type: this._type(n),
        color: this._color(n),
        watchers: n.__watchers ? Array.from(n.__watchers) : [],
        hasDOM: !!this._dom(n),
        x: Math.random() * 800,
        y: Math.random() * 600
      };
      this.nodes.push(data);
      this.nodeMap.set(path, data);
      const entries = n.__nodes ? Object.entries(n.__nodes) : [];
      for (const [k, c] of entries) {
        const childPath = path === "root" ? k : `${path}.${k}`;
        traverse(c, childPath);
        this.links.push({ source: path, target: childPath, type: "hierarchy" });
      }
    };
    traverse(this.fx.root);
  }
  _render() {
    if (!this.svg || typeof d3 === "undefined") return;
    const nodes = this.nodes, links = this.links;
    const sim = d3.forceSimulation(nodes).force("link", d3.forceLink(links).id((d) => d.id).distance(100)).force("charge", d3.forceManyBody().strength(-200)).force("center", d3.forceCenter(400, 300));
    const linkSel = this.svg.selectAll("line").data(links);
    linkSel.enter().append("line").merge(linkSel).attr("stroke", "#6b7280");
    const nodeSel = this.svg.selectAll("circle").data(nodes);
    nodeSel.enter().append("circle").attr("r", 6).merge(nodeSel).attr("fill", (d) => d.color).call(d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended)).on("click", (_, d) => console.log("FX node", d.path, d));
    sim.on("tick", () => {
      linkSel.attr("x1", (d) => pos(d.source.x, 800)).attr("y1", (d) => pos(d.source.y, 600)).attr("x2", (d) => pos(d.target.x, 800)).attr("y2", (d) => pos(d.target.y, 600));
      nodeSel.attr("cx", (d) => pos(d.x, 800)).attr("cy", (d) => pos(d.y, 600));
    });
    function pos(v, max) {
      return Math.max(0, Math.min(max, v || 0));
    }
    function dragstarted(event) {
      if (!event.active) sim.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }
    function dragged(event) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }
    function dragended(event) {
      if (!event.active) sim.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }
  }
  _type(n) {
    if (n.__type) return n.__type;
    if (typeof n.__value === "function") return "function";
    if (n.__value !== void 0 && ["string", "number", "boolean"].includes(typeof n.__value)) return "primitive";
    return "json";
  }
  _color(n) {
    const t = this._type(n);
    return { json: "#3b82f6", function: "#ec4899", primitive: "#f59e0b" }[t] || "#64748b";
  }
  _dom(n) {
    const inst = n.__instances;
    if (!inst) return null;
    for (const i of inst.values?.() || []) if (i?._element instanceof HTMLElement) return i._element;
    return null;
  }
}
var stdin_default = FXVisualizerPlugin;
