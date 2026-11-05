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
  FXRouter: () => FXRouter,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class RouterLogger {
  static log(level, message, data = {}) {
    console.log(`[FX-ROUTER:${level.toUpperCase()}]`, message, data);
  }
  static error(message, error) {
    this.log("error", message, { error });
  }
  static warn(message, data) {
    this.log("warn", message, data);
  }
  static info(message, data) {
    this.log("info", message, data);
  }
}
class FXPage {
  router;
  config;
  path;
  component;
  template;
  data;
  guards;
  meta;
  cache;
  preload;
  isLoaded = false;
  isActive = false;
  element = null;
  fxNode = null;
  componentInstance;
  templateContent;
  constructor(config, router) {
    this.router = router;
    this.config = config;
    this.path = config.path;
    this.component = config.component;
    this.template = config.template;
    this.data = config.data || {};
    this.guards = config.guards || [];
    this.meta = config.meta || {};
    this.cache = config.cache !== false;
    this.preload = config.preload || [];
  }
  async load() {
    if (this.isLoaded && this.cache) return this;
    try {
      RouterLogger.info(`Loading page: ${this.path}`);
      if (this.component) {
        const modules = this.router.getFX().pluginManager?.getByPrefix("modules");
        if (modules) {
          const componentModule = await modules.load(this.component);
          this.componentInstance = componentModule.exports;
        }
      }
      if (this.template) {
        const response = await fetch(this.template);
        if (!response.ok) {
          throw new Error(`Failed to load template: ${response.status}`);
        }
        this.templateContent = await response.text();
      }
      await this.preloadDependencies();
      const pageKey = this.getPageKey();
      this.fxNode = this.router.getFX().createNodeProxy(
        this.router.getFX().setPath(`pages.${pageKey}`, this.data, this.router.getFX().root)
      );
      this.isLoaded = true;
      RouterLogger.info(`Page loaded: ${this.path}`);
      return this;
    } catch (error) {
      RouterLogger.error(`Failed to load page: ${this.path}`, error);
      throw error;
    }
  }
  async preloadDependencies() {
    if (this.preload.length === 0) return;
    const cache = this.router.getFX().pluginManager?.getByPrefix("cache");
    const modules = this.router.getFX().pluginManager?.getByPrefix("modules");
    if (!modules) return;
    const preloadPromises = this.preload.map(async (dep) => {
      try {
        if (dep.startsWith("http") || dep.endsWith(".html")) {
          if (cache) {
            await cache.getOrSet(
              `template:${dep}`,
              () => fetch(dep).then((r) => r.text())
            );
          }
        } else {
          await modules.load(dep);
        }
      } catch (error) {
        RouterLogger.warn(`Failed to preload dependency: ${dep}`, error);
      }
    });
    await Promise.allSettled(preloadPromises);
  }
  async activate(params = {}) {
    if (!this.isLoaded) await this.load();
    try {
      RouterLogger.info(`Activating page: ${this.path}`, { params });
      for (const guard of this.guards) {
        const canActivate = await this.executeGuard(guard, params);
        if (!canActivate) {
          throw new Error(`Guard failed for page: ${this.path}`);
        }
      }
      Object.assign(this.data, params);
      if (this.fxNode) {
        this.fxNode.set({ ...this.data, params });
      }
      await this.render();
      this.isActive = true;
      RouterLogger.info(`Page activated: ${this.path}`);
    } catch (error) {
      RouterLogger.error(`Failed to activate page: ${this.path}`, error);
      throw error;
    }
  }
  async deactivate() {
    if (!this.isActive) return;
    try {
      RouterLogger.info(`Deactivating page: ${this.path}`);
      if (this.element && this.element.parentNode) {
        this.element.parentNode.removeChild(this.element);
      }
      this.isActive = false;
      RouterLogger.info(`Page deactivated: ${this.path}`);
    } catch (error) {
      RouterLogger.error(`Failed to deactivate page: ${this.path}`, error);
    }
  }
  async render() {
    const targetElement = this.router.getTargetElement();
    if (!targetElement) {
      throw new Error("No target element found for page rendering");
    }
    targetElement.innerHTML = "";
    this.element = document.createElement("div");
    this.element.className = `fx-page fx-page-${this.getPageKey()}`;
    this.element.setAttribute("fx-path", `pages.${this.getPageKey()}`);
    if (this.componentInstance && typeof this.componentInstance.render === "function") {
      const content = await this.componentInstance.render(this.data);
      this.element.innerHTML = content;
    } else if (this.templateContent) {
      const rendered = this.renderTemplate(this.templateContent, this.data);
      this.element.innerHTML = rendered;
    } else {
      this.element.innerHTML = `<h1>Page: ${this.path}</h1>`;
    }
    const dom = this.router.getFX().pluginManager?.getByPrefix("dom");
    if (dom) {
      dom.enhance(this.element);
    }
    targetElement.appendChild(this.element);
  }
  renderTemplate(template, data) {
    return template.replace(/\{\{(.+?)\}\}/g, (match, expr) => {
      try {
        const func = new Function(...Object.keys(data), `return ${expr}`);
        return func(...Object.values(data));
      } catch (error) {
        RouterLogger.warn(`Template render error: ${expr}`, error);
        return match;
      }
    });
  }
  async executeGuard(guard, params) {
    if (typeof guard === "function") {
      return await guard(this, params);
    } else if (typeof guard === "string") {
      const guardRegistry = this.router.getGuardRegistry();
      if (guardRegistry.has(guard)) {
        return await guardRegistry.get(guard)(this, params);
      }
    }
    return true;
  }
  getPageKey() {
    return this.path.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+|_+$/g, "");
  }
}
class FXRouter {
  fx;
  options;
  name = "router";
  version = "2.0.0";
  description = "Complete routing and page management system with FX integration";
  routes = /* @__PURE__ */ new Map();
  pages = /* @__PURE__ */ new Map();
  guardRegistry = /* @__PURE__ */ new Map();
  currentPage = null;
  currentRoute = null;
  history = [];
  isNavigating = false;
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      mode: "history",
      target: "#app",
      base: "/",
      caseSensitive: false,
      trailingSlash: false,
      ...options
    };
    this.initRouter();
    RouterLogger.info("FX Router initialized", { mode: this.options.mode });
  }
  getFX() {
    return this.fx;
  }
  getGuardRegistry() {
    return this.guardRegistry;
  }
  initRouter() {
    if (this.options.mode === "history") {
      window.addEventListener("popstate", (event) => {
        this.handlePopState(event);
      });
    } else {
      window.addEventListener("hashchange", (event) => {
        this.handleHashChange(event);
      });
    }
    this.handleInitialRoute();
    this.interceptLinks();
  }
  handleInitialRoute() {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }
  getCurrentPath() {
    if (this.options.mode === "history") {
      let path = window.location.pathname;
      if (this.options.base !== "/") {
        path = path.replace(new RegExp(`^${this.options.base}`), "") || "/";
      }
      return path;
    } else {
      return window.location.hash.slice(1) || "/";
    }
  }
  interceptLinks() {
    document.addEventListener("click", (event) => {
      const link = event.target?.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }
      if (link.target === "_blank" || link.hasAttribute("download")) {
        return;
      }
      if (link.hasAttribute("fx-external")) {
        return;
      }
      event.preventDefault();
      this.navigate(href);
    });
  }
  route(path, config) {
    const routeConfig = { path, ...config };
    const route = {
      ...routeConfig,
      pattern: this.pathToRegex(path),
      paramNames: this.extractParamNames(path)
    };
    this.routes.set(path, route);
    const page = new FXPage(routeConfig, this);
    this.pages.set(path, page);
    RouterLogger.info(`Route registered: ${path}`);
    return this;
  }
  pathToRegex(path) {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\:([^/]+)/g, "([^/]+)");
    return new RegExp(`^${escaped}$`);
  }
  extractParamNames(path) {
    const matches = path.match(/:([^/]+)/g);
    return matches ? matches.map((match) => match.slice(1)) : [];
  }
  async navigate(path, options = {}) {
    if (this.isNavigating) return;
    try {
      this.isNavigating = true;
      RouterLogger.info(`Navigating to: ${path}`);
      path = this.normalizePath(path);
      const { route, params } = this.matchRoute(path);
      if (!route) {
        throw new Error(`No route found for path: ${path}`);
      }
      const page = this.pages.get(route.path);
      if (!page) {
        throw new Error(`No page found for route: ${route.path}`);
      }
      if (this.currentPage && this.currentPage !== page) {
        await this.currentPage.deactivate();
      }
      await page.activate(params);
      if (!options.replace) {
        this.updateHistory(path);
      } else {
        this.replaceHistory(path);
      }
      this.currentPage = page;
      this.currentRoute = route;
      this.history.push({ path, params, timestamp: Date.now() });
      this.fx.setPath("router.currentPath", path, this.fx.root);
      this.fx.setPath("router.currentParams", params, this.fx.root);
      document.dispatchEvent(new CustomEvent("fx:navigate", {
        detail: { path, route, params, page }
      }));
      RouterLogger.info(`Navigation completed: ${path}`);
    } catch (error) {
      RouterLogger.error(`Navigation failed: ${path}`, error);
      if (path !== "/error" && this.routes.has("/error")) {
        this.navigate("/error", { replace: true });
      }
      throw error;
    } finally {
      this.isNavigating = false;
    }
  }
  matchRoute(path) {
    for (const [routePath, route] of this.routes) {
      const match = path.match(route.pattern);
      if (match) {
        const params = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return { route, params };
      }
    }
    return { route: null, params: {} };
  }
  normalizePath(path) {
    if (!path.startsWith("/")) path = "/" + path;
    if (!this.options.trailingSlash && path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    if (!this.options.caseSensitive) {
      path = path.toLowerCase();
    }
    return path;
  }
  updateHistory(path) {
    if (this.options.mode === "history") {
      const url = this.options.base === "/" ? path : this.options.base + path;
      window.history.pushState({ path }, "", url);
    } else {
      window.location.hash = path;
    }
  }
  replaceHistory(path) {
    if (this.options.mode === "history") {
      const url = this.options.base === "/" ? path : this.options.base + path;
      window.history.replaceState({ path }, "", url);
    } else {
      window.location.replace(`${window.location.pathname}#${path}`);
    }
  }
  handlePopState(event) {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }
  handleHashChange(event) {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }
  guard(name, guardFunction) {
    this.guardRegistry.set(name, guardFunction);
    RouterLogger.info(`Guard registered: ${name}`);
    return this;
  }
  getTargetElement() {
    return document.querySelector(this.options.target);
  }
  // Navigation methods
  push(path) {
    return this.navigate(path);
  }
  replace(path) {
    return this.navigate(path, { replace: true });
  }
  back() {
    window.history.back();
  }
  forward() {
    window.history.forward();
  }
  go(delta) {
    window.history.go(delta);
  }
  getCurrentRoute() {
    return this.currentRoute;
  }
  getCurrentParams() {
    const node = this.fx.resolvePath("router.currentParams", this.fx.root);
    if (!node) return {};
    const raw = this.fx.createNodeProxy(node).val();
    const result = {};
    if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw)) {
        result[k] = String(v);
      }
    }
    return result;
  }
  getHistory() {
    return [...this.history];
  }
  async preloadRoute(path) {
    const { route } = this.matchRoute(path);
    if (route) {
      const page = this.pages.get(route.path);
      if (page) {
        await page.load();
      }
    }
  }
}
function stdin_default(fx, options) {
  const router = new FXRouter(fx, options);
  if (typeof globalThis !== "undefined") {
    globalThis.$router = router;
    globalThis.$route = () => router.getCurrentRoute();
    globalThis.$navigate = (path) => router.navigate(path);
  }
  return router;
}
