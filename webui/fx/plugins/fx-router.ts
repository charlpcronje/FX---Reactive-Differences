// /plugins/fx-router.ts
/**
 * FX Router - TypeScript Enhanced Page Routing and Management
 * Complete routing system with reactive FX integration and page lifecycle
 */

import type { FXCore, FXNodeProxy } from '../fx.v4';

interface RouteConfig {
  path: string;
  component?: string;
  template?: string;
  data?: Record<string, any>;
  guards?: (string | GuardFunction)[];
  meta?: Record<string, any>;
  cache?: boolean;
  preload?: string[];
}

interface RoutePattern {
  path: string;
  pattern: RegExp;
  paramNames: string[];
}

interface RouteMatch {
  route: RoutePattern | null;
  params: Record<string, string>;
}

interface RouterOptions {
  mode: 'history' | 'hash';
  target: string;
  base: string;
  caseSensitive: boolean;
  trailingSlash: boolean;
}

interface NavigationEvent {
  path: string;
  route: RoutePattern;
  params: Record<string, string>;
  page: FXPage;
}

type GuardFunction = (page: FXPage, params: Record<string, string>) => boolean | Promise<boolean>;

class RouterLogger {
  static log(level: string, message: string, data: any = {}): void {
    console.log(`[FX-ROUTER:${level.toUpperCase()}]`, message, data);
  }
  static error(message: string, error: any): void { this.log('error', message, { error }); }
  static warn(message: string, data?: any): void { this.log('warn', message, data); }
  static info(message: string, data?: any): void { this.log('info', message, data); }
}

class FXPage {
  private router: FXRouter;
  private config: RouteConfig;
  public path: string;
  public component?: string;
  public template?: string;
  public data: Record<string, any>;
  public guards: (string | GuardFunction)[];
  public meta: Record<string, any>;
  public cache: boolean;
  public preload: string[];
  
  public isLoaded = false;
  public isActive = false;
  public element: Element | null = null;
  public fxNode: FXNodeProxy | null = null;
  
  private componentInstance?: any;
  private templateContent?: string;

  constructor(config: RouteConfig, router: FXRouter) {
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

  async load(): Promise<this> {
    if (this.isLoaded && this.cache) return this;

    try {
      RouterLogger.info(`Loading page: ${this.path}`);

      if (this.component) {
        const modules = this.router.getFX().pluginManager?.getByPrefix('modules');
        if (modules) {
          const componentModule = await (modules as any).load(this.component);
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

      // Create FX node for this page
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

  private async preloadDependencies(): Promise<void> {
    if (this.preload.length === 0) return;

    const cache = this.router.getFX().pluginManager?.getByPrefix('cache');
    const modules = this.router.getFX().pluginManager?.getByPrefix('modules');

    if (!modules) return;

    const preloadPromises = this.preload.map(async (dep) => {
      try {
        if (dep.startsWith('http') || dep.endsWith('.html')) {
          if (cache) {
            await (cache as any).getOrSet(`template:${dep}`, () => 
              fetch(dep).then(r => r.text())
            );
          }
        } else {
          await (modules as any).load(dep);
        }
      } catch (error) {
        RouterLogger.warn(`Failed to preload dependency: ${dep}`, error);
      }
    });

    await Promise.allSettled(preloadPromises);
  }

  async activate(params: Record<string, string> = {}): Promise<void> {
    if (!this.isLoaded) await this.load();

    try {
      RouterLogger.info(`Activating page: ${this.path}`, { params });

      // Check guards
      for (const guard of this.guards) {
        const canActivate = await this.executeGuard(guard, params);
        if (!canActivate) {
          throw new Error(`Guard failed for page: ${this.path}`);
        }
      }

      // Update page data with params
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

  async deactivate(): Promise<void> {
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

  private async render(): Promise<void> {
    const targetElement = this.router.getTargetElement();
    if (!targetElement) {
      throw new Error('No target element found for page rendering');
    }

    targetElement.innerHTML = '';

    this.element = document.createElement('div');
    this.element.className = `fx-page fx-page-${this.getPageKey()}`;
    this.element.setAttribute('fx-path', `pages.${this.getPageKey()}`);

    if (this.componentInstance && typeof this.componentInstance.render === 'function') {
      const content = await this.componentInstance.render(this.data);
      this.element.innerHTML = content;
    } else if (this.templateContent) {
      const rendered = this.renderTemplate(this.templateContent, this.data);
      this.element.innerHTML = rendered;
    } else {
      this.element.innerHTML = `<h1>Page: ${this.path}</h1>`;
    }

    // Make element reactive
    const dom = this.router.getFX().pluginManager?.getByPrefix('dom');
    if (dom) {
      (dom as any).enhance(this.element);
    }

    targetElement.appendChild(this.element);
  }

  private renderTemplate(template: string, data: Record<string, any>): string {
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

  private async executeGuard(guard: string | GuardFunction, params: Record<string, string>): Promise<boolean> {
    if (typeof guard === 'function') {
      return await guard(this, params);
    } else if (typeof guard === 'string') {
      const guardRegistry = this.router.getGuardRegistry();
      if (guardRegistry.has(guard)) {
        return await guardRegistry.get(guard)!(this, params);
      }
    }
    return true;
  }

  getPageKey(): string {
    return this.path.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '');
  }
}

export class FXRouter {
  private fx: FXCore;
  private options: RouterOptions;

  public readonly name = 'router';
  public readonly version = '2.0.0';
  public readonly description = 'Complete routing and page management system with FX integration';

  private routes = new Map<string, RoutePattern & RouteConfig>();
  private pages = new Map<string, FXPage>();
  private guardRegistry = new Map<string, GuardFunction>();
  private currentPage: FXPage | null = null;
  private currentRoute: RoutePattern | null = null;
  private history: Array<{ path: string; params: Record<string, string>; timestamp: number }> = [];
  private isNavigating = false;

  constructor(fx: FXCore, options: Partial<RouterOptions> = {}) {
    this.fx = fx;
    this.options = {
      mode: 'history',
      target: '#app',
      base: '/',
      caseSensitive: false,
      trailingSlash: false,
      ...options
    };

    this.initRouter();
    RouterLogger.info('FX Router initialized', { mode: this.options.mode });
  }

  getFX(): FXCore {
    return this.fx;
  }

  getGuardRegistry(): Map<string, GuardFunction> {
    return this.guardRegistry;
  }

  private initRouter(): void {
    if (this.options.mode === 'history') {
      window.addEventListener('popstate', (event) => {
        this.handlePopState(event);
      });
    } else {
      window.addEventListener('hashchange', (event) => {
        this.handleHashChange(event);
      });
    }

    this.handleInitialRoute();
    this.interceptLinks();
  }

  private handleInitialRoute(): void {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }

  private getCurrentPath(): string {
    if (this.options.mode === 'history') {
      let path = window.location.pathname;
      if (this.options.base !== '/') {
        path = path.replace(new RegExp(`^${this.options.base}`), '') || '/';
      }
      return path;
    } else {
      return window.location.hash.slice(1) || '/';
    }
  }

  private interceptLinks(): void {
    document.addEventListener('click', (event) => {
      const link = (event.target as Element)?.closest('a[href]') as HTMLAnchorElement;
      if (!link) return;

      const href = link.getAttribute('href')!;
      
      if (href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:')) {
        return;
      }

      if (link.target === '_blank' || link.hasAttribute('download')) {
        return;
      }

      if (link.hasAttribute('fx-external')) {
        return;
      }

      event.preventDefault();
      this.navigate(href);
    });
  }

  route(path: string, config: Omit<RouteConfig, 'path'>): this {
    const routeConfig: RouteConfig = { path, ...config };
    
    const route: RoutePattern & RouteConfig = {
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

  private pathToRegex(path: string): RegExp {
    const escaped = path
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\:([^/]+)/g, '([^/]+)');
    
    return new RegExp(`^${escaped}$`);
  }

  private extractParamNames(path: string): string[] {
    const matches = path.match(/:([^/]+)/g);
    return matches ? matches.map(match => match.slice(1)) : [];
  }

  async navigate(path: string, options: { replace?: boolean } = {}): Promise<void> {
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

      // Update FX state
      this.fx.setPath('router.currentPath', path, this.fx.root);
      this.fx.setPath('router.currentParams', params, this.fx.root);

      document.dispatchEvent(new CustomEvent('fx:navigate', {
        detail: { path, route, params, page } as NavigationEvent
      }));

      RouterLogger.info(`Navigation completed: ${path}`);

    } catch (error) {
      RouterLogger.error(`Navigation failed: ${path}`, error);
      
      if (path !== '/error' && this.routes.has('/error')) {
        this.navigate('/error', { replace: true });
      }
      
      throw error;
    } finally {
      this.isNavigating = false;
    }
  }

  private matchRoute(path: string): RouteMatch {
    for (const [routePath, route] of this.routes) {
      const match = path.match(route.pattern);
      if (match) {
        const params: Record<string, string> = {};
        route.paramNames.forEach((name, index) => {
          params[name] = match[index + 1];
        });
        return { route, params };
      }
    }
    return { route: null, params: {} };
  }

  private normalizePath(path: string): string {
    if (!path.startsWith('/')) path = '/' + path;
    
    if (!this.options.trailingSlash && path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    
    if (!this.options.caseSensitive) {
      path = path.toLowerCase();
    }
    
    return path;
  }

  private updateHistory(path: string): void {
    if (this.options.mode === 'history') {
      const url = this.options.base === '/' ? path : this.options.base + path;
      window.history.pushState({ path }, '', url);
    } else {
      window.location.hash = path;
    }
  }

  private replaceHistory(path: string): void {
    if (this.options.mode === 'history') {
      const url = this.options.base === '/' ? path : this.options.base + path;
      window.history.replaceState({ path }, '', url);
    } else {
      window.location.replace(`${window.location.pathname}#${path}`);
    }
  }

  private handlePopState(event: PopStateEvent): void {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }

  private handleHashChange(event: HashChangeEvent): void {
    const path = this.getCurrentPath();
    this.navigate(path, { replace: true });
  }

  guard(name: string, guardFunction: GuardFunction): this {
    this.guardRegistry.set(name, guardFunction);
    RouterLogger.info(`Guard registered: ${name}`);
    return this;
  }

  getTargetElement(): Element | null {
    return document.querySelector(this.options.target);
  }

  // Navigation methods
  push(path: string): Promise<void> {
    return this.navigate(path);
  }

  replace(path: string): Promise<void> {
    return this.navigate(path, { replace: true });
  }

  back(): void {
    window.history.back();
  }

  forward(): void {
    window.history.forward();
  }

  go(delta: number): void {
    window.history.go(delta);
  }

  getCurrentRoute(): RoutePattern | null {
    return this.currentRoute;
  }

  getCurrentParams(): Record<string, string> {
    const node = this.fx.resolvePath('router.currentParams', this.fx.root);
    if (!node) return {};
    const raw = this.fx.createNodeProxy(node).val();
    const result: Record<string, string> = {};
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        result[k] = String(v as any);
      }
    }
    return result;
  }

  getHistory(): typeof FXRouter.prototype.history {
    return [...this.history];
  }

  async preloadRoute(path: string): Promise<void> {
    const { route } = this.matchRoute(path);
    if (route) {
      const page = this.pages.get(route.path);
      if (page) {
        await page.load();
      }
    }
  }
}

// Export plugin factory
export default function(fx: FXCore, options?: Partial<RouterOptions>): FXRouter {
  const router = new FXRouter(fx, options);
  
  if (typeof globalThis !== 'undefined') {
    (globalThis as any).$router = router;
    (globalThis as any).$route = () => router.getCurrentRoute();
    (globalThis as any).$navigate = (path: string) => router.navigate(path);
  }
  
  return router;
}