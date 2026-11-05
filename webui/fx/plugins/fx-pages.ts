/**
 * fx-pages.ts — TypeScript port + enhancements
 * Layouts + nested routing. Async rendering internals; sync API surface.
 */
import type { FX, FXPlugin } from "./fx-types";

type LayoutConfig = {
  name: string;
  template?: string;
  component?: string;
  slots?: Record<string, string>;
  data?: Record<string, any>;
  cache?: boolean;
};

type PageConfig = {
  layout?: string;
  template?: string;
  component?: string;
  breadcrumb?: string | { title: string };
  nested?: boolean;
  layoutData?: Record<string, any>;
  data?: Record<string, any>;
};

class FXLayout {
  public isLoaded = false;
  public element: HTMLElement | null = null;
  public templateContent = "";
  public componentInstance: any = null;

  constructor(private cfg: LayoutConfig, private pages: FXPagesPlugin) {}

  async load() {
    if (this.isLoaded && this.cfg.cache !== false) return;
    if (this.cfg.component) {
      const modules = this.pages.fx.pluginManager.getByPrefix("modules");
      if (!modules || !modules.loadSync) throw new Error("modules plugin with loadSync required");
      this.componentInstance = modules.loadSync(this.cfg.component);
    }
    if (this.cfg.template) {
      // try cache plugin
      const cache = this.pages.fx.pluginManager.getByPrefix("cache");
      if (cache?.getSync) {
        const hit = cache.getSync(`layout:${this.cfg.template}`);
        if (hit) this.templateContent = hit;
        else {
          const resp = await fetch(this.cfg.template);
          const txt = await resp.text();
          this.templateContent = txt;
          cache.setSync?.(`layout:${this.cfg.template}`, txt, { ttl: 600000 });
        }
      } else {
        const resp = await fetch(this.cfg.template);
        this.templateContent = await resp.text();
      }
    }
    this.isLoaded = true;
  }

  async render(target: HTMLElement) {
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

  private _renderTemplate(tpl: string, data: Record<string, any>) {
    return tpl.replace(/\{\{(.+?)\}\}/g, (_m, expr) => {
      if (String(expr).startsWith("slot:")) {
        const slot = String(expr).slice(5).trim();
        return `<div fx-slot="${slot}"></div>`;
      }
      try { return new Function(...Object.keys(data), `return ${expr}`)(...Object.values(data)); }
      catch { return ""; }
    });
  }

  getSlot(name = "main"): HTMLElement | null {
    return this.element?.querySelector(`[fx-slot="${name}"]`) ?? null;
  }

  updateData(d: Record<string, any>) { this.cfg.data = Object.assign(this.cfg.data || {}, d); }
}

export class FXPagesPlugin implements FXPlugin {
  public name = "pages";
  public version = "1.1.0";
  public description = "Layouts + nested routing for FX";
  public fx: FX;

  private layouts = new Map<string, FXLayout>();
  private breadcrumbs: { path: string; title: string; timestamp: number }[] = [];
  private currentLayoutName = "default";

  constructor(fx: FX, opts: Partial<{ defaultLayout: string }> = {}) {
    this.fx = fx;
    this.currentLayoutName = opts.defaultLayout || "default";
    // default layout
    this.layout("default", { name: "default", template: `
      <div class="fx-app">
        <header>{{slot:header}}</header>
        <main>{{slot:main}}</main>
        <footer>{{slot:footer}}</footer>
      </div>` });
  }

  install = (fx: FX) => void 0;

  layout(name: string, cfg: Omit<LayoutConfig, "name">) {
    const L = new FXLayout({ name, ...cfg }, this);
    this.layouts.set(name, L);
    return this;
  }

  page(path: string, cfg: PageConfig) {
    // integrate with router if present
    const router = this.fx.pluginManager.getByPrefix("router");
    if (router?.route) {
      router.route(path, {
        ...cfg,
        beforeActivate: async (_page: any, params: any) => {
          const layout = cfg.layout || this.currentLayoutName;
          await this.activateLayout(layout, cfg.layoutData);
          if (cfg.breadcrumb) this._breadcrumb(path, cfg.breadcrumb, params);
        }
      });
    }
    return this;
  }

  async activateLayout(name: string, data?: Record<string, any>) {
    const L = this.layouts.get(name);
    if (!L) throw new Error(`Layout not found: ${name}`);
    const target = document.getElementById("app") || document.body;
    if (data) L.updateData(data);
    await L.render(target);
    this.currentLayoutName = name;
  }

  slot(name = "main"): HTMLElement | null {
    return this.layouts.get(this.currentLayoutName)?.getSlot(name) ?? null;
  }

  private _breadcrumb(path: string, b: string | { title: string }, params: Record<string, any>) {
    const title = typeof b === "string" ? b : b.title;
    this.breadcrumbs.push({ path, title, timestamp: Date.now() });
    if (this.breadcrumbs.length > 10) this.breadcrumbs.shift();
    this.fx.setPath("pages.breadcrumbs", this.breadcrumbs, this.fx.root);
  }
}

export default FXPagesPlugin;
