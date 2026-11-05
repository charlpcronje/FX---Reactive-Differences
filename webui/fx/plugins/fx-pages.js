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
  FXPagesPlugin: () => FXPagesPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class FXLayout {
  constructor(cfg, pages) {
    this.cfg = cfg;
    this.pages = pages;
  }
  isLoaded = false;
  element = null;
  templateContent = "";
  componentInstance = null;
  async load() {
    if (this.isLoaded && this.cfg.cache !== false) return;
    if (this.cfg.component) {
      const modules = this.pages.fx.pluginManager.getByPrefix("modules");
      if (!modules || !modules.loadSync) throw new Error("modules plugin with loadSync required");
      this.componentInstance = modules.loadSync(this.cfg.component);
    }
    if (this.cfg.template) {
      const cache = this.pages.fx.pluginManager.getByPrefix("cache");
      if (cache?.getSync) {
        const hit = cache.getSync(`layout:${this.cfg.template}`);
        if (hit) this.templateContent = hit;
        else {
          const resp = await fetch(this.cfg.template);
          const txt = await resp.text();
          this.templateContent = txt;
          cache.setSync?.(`layout:${this.cfg.template}`, txt, { ttl: 6e5 });
        }
      } else {
        const resp = await fetch(this.cfg.template);
        this.templateContent = await resp.text();
      }
    }
    this.isLoaded = true;
  }
  async render(target) {
    if (!this.isLoaded) await this.load();
    target.innerHTML = "";
    const el = document.createElement("div");
    el.className = `fx-layout fx-layout-${this.cfg.name}`;
    if (this.componentInstance?.render) {
      el.innerHTML = await this.componentInstance.render(this.cfg.data || {});
    } else if (this.templateContent) {
      el.innerHTML = this._renderTemplate(this.templateContent, this.cfg.data || {});
    } else {
      el.innerHTML = `<div fx-slot="header"></div><div fx-slot="main"></div><div fx-slot="footer"></div>`;
    }
    target.appendChild(el);
    this.element = el;
  }
  _renderTemplate(tpl, data) {
    return tpl.replace(/\{\{(.+?)\}\}/g, (_m, expr) => {
      if (String(expr).startsWith("slot:")) {
        const slot = String(expr).slice(5).trim();
        return `<div fx-slot="${slot}"></div>`;
      }
      try {
        return new Function(...Object.keys(data), `return ${expr}`)(...Object.values(data));
      } catch {
        return "";
      }
    });
  }
  getSlot(name = "main") {
    return this.element?.querySelector(`[fx-slot="${name}"]`) ?? null;
  }
  updateData(d) {
    this.cfg.data = Object.assign(this.cfg.data || {}, d);
  }
}
class FXPagesPlugin {
  name = "pages";
  version = "1.1.0";
  description = "Layouts + nested routing for FX";
  fx;
  layouts = /* @__PURE__ */ new Map();
  breadcrumbs = [];
  currentLayoutName = "default";
  constructor(fx, opts = {}) {
    this.fx = fx;
    this.currentLayoutName = opts.defaultLayout || "default";
    this.layout("default", { name: "default", template: `
      <div class="fx-app">
        <header>{{slot:header}}</header>
        <main>{{slot:main}}</main>
        <footer>{{slot:footer}}</footer>
      </div>` });
  }
  install = (fx) => void 0;
  layout(name, cfg) {
    const L = new FXLayout({ name, ...cfg }, this);
    this.layouts.set(name, L);
    return this;
  }
  page(path, cfg) {
    const router = this.fx.pluginManager.getByPrefix("router");
    if (router?.route) {
      router.route(path, {
        ...cfg,
        beforeActivate: async (_page, params) => {
          const layout = cfg.layout || this.currentLayoutName;
          await this.activateLayout(layout, cfg.layoutData);
          if (cfg.breadcrumb) this._breadcrumb(path, cfg.breadcrumb, params);
        }
      });
    }
    return this;
  }
  async activateLayout(name, data) {
    const L = this.layouts.get(name);
    if (!L) throw new Error(`Layout not found: ${name}`);
    const target = document.getElementById("app") || document.body;
    if (data) L.updateData(data);
    await L.render(target);
    this.currentLayoutName = name;
  }
  slot(name = "main") {
    return this.layouts.get(this.currentLayoutName)?.getSlot(name) ?? null;
  }
  _breadcrumb(path, b, params) {
    const title = typeof b === "string" ? b : b.title;
    this.breadcrumbs.push({ path, title, timestamp: Date.now() });
    if (this.breadcrumbs.length > 10) this.breadcrumbs.shift();
    this.fx.setPath("pages.breadcrumbs", this.breadcrumbs, this.fx.root);
  }
}
var stdin_default = FXPagesPlugin;
