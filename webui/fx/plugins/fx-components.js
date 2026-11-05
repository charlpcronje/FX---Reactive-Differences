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
  FXComponents: () => FXComponents,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class ComponentsLogger {
  static log(level, message, data = {}) {
    console.log(`[FX-COMPONENTS:${level.toUpperCase()}]`, message, data);
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
class FXCParser {
  xsltProcessor = null;
  coreXSLT = null;
  constructor() {
    this.initXSLT();
  }
  initXSLT() {
    this.coreXSLT = this.createCoreXSLT();
    if (typeof XSLTProcessor !== "undefined") {
      this.xsltProcessor = new XSLTProcessor();
      this.xsltProcessor.importStylesheet(this.coreXSLT);
      ComponentsLogger.info("XSLT processor initialized");
    }
  }
  createCoreXSLT() {
    const xsltContent = `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
    <xsl:template match="@*|node()">
        <xsl:copy>
            <xsl:apply-templates select="@*|node()"/>
        </xsl:copy>
    </xsl:template>
    
    <xsl:template match="fx-text">
        <span fx-bind="{@path}" fx-type="text">{{<xsl:value-of select="@path"/>}}</span>
    </xsl:template>
    
    <xsl:template match="fx-if">
        <div fx-if="{@test}" style="display: none;">
            <xsl:apply-templates select="node()"/>
        </div>
    </xsl:template>
    
    <xsl:template match="fx-each">
        <div fx-each="{@path}">
            <xsl:apply-templates select="node()"/>
        </div>
    </xsl:template>
</xsl:stylesheet>`;
    const parser = new DOMParser();
    return parser.parseFromString(xsltContent, "application/xml");
  }
  parse(fxcContent, url) {
    try {
      const component = {
        url,
        metadata: {},
        sections: {},
        dependencies: []
      };
      const metadataMatch = fxcContent.match(/^---\n([\s\S]*?)\n---/);
      if (metadataMatch) {
        component.metadata = this.parseYAML(metadataMatch[1]);
        fxcContent = fxcContent.replace(metadataMatch[0], "").trim();
      }
      const sections = this.extractSections(fxcContent);
      component.sections = sections;
      component.dependencies = this.extractDependencies(sections);
      ComponentsLogger.info(`Parsed component: ${component.metadata.name || url}`);
      return component;
    } catch (error) {
      ComponentsLogger.error(`Failed to parse FXC: ${url}`, error);
      throw error;
    }
  }
  parseYAML(yamlStr) {
    const result = {};
    const lines = yamlStr.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > -1) {
        const key = trimmed.substring(0, colonIndex).trim();
        const value = trimmed.substring(colonIndex + 1).trim();
        if (value) {
          result[key] = this.parseYAMLValue(value);
        } else {
          result[key] = {};
        }
      }
    }
    return result;
  }
  parseYAMLValue(value) {
    if (!value) return null;
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^\d+$/.test(value)) return parseInt(value);
    if (/^\d*\.\d+$/.test(value)) return parseFloat(value);
    if (value.startsWith("[") && value.endsWith("]")) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value.replace(/^['"]|['"]$/g, "");
  }
  extractSections(content) {
    const sections = {};
    const sectionRegex = /^---\s*(\w+)\s*\n([\s\S]*?)(?=\n---\s*\w+|$)/gm;
    let match;
    while ((match = sectionRegex.exec(content)) !== null) {
      const [, sectionName, sectionContent] = match;
      sections[sectionName] = sectionContent.trim();
    }
    return sections;
  }
  extractDependencies(sections) {
    const dependencies = [];
    const seen = /* @__PURE__ */ new Set();
    if (sections.template) {
      const componentRefs = sections.template.match(/<fx-component[^>]*src\s*=\s*['"]([^'"]+)['"]/g);
      if (componentRefs) {
        componentRefs.forEach((ref) => {
          const srcMatch = ref.match(/src\s*=\s*['"]([^'"]+)['"]/);
          if (srcMatch && !seen.has(srcMatch[1])) {
            dependencies.push({
              type: "component",
              path: srcMatch[1],
              section: "template"
            });
            seen.add(srcMatch[1]);
          }
        });
      }
    }
    if (sections.script) {
      const importMatches = sections.script.match(/import\s+.*?from\s+['"]([^'"]+)['"]/g);
      if (importMatches) {
        importMatches.forEach((imp) => {
          const pathMatch = imp.match(/from\s+['"]([^'"]+)['"]/);
          if (pathMatch && !seen.has(pathMatch[1])) {
            dependencies.push({
              type: "module",
              path: pathMatch[1],
              section: "script"
            });
            seen.add(pathMatch[1]);
          }
        });
      }
    }
    return dependencies;
  }
  transformTemplate(template, metadata = {}) {
    if (!this.xsltProcessor) {
      ComponentsLogger.warn("XSLT processor not available");
      return template;
    }
    try {
      const wrappedTemplate = `<fx-template>${template}</fx-template>`;
      const parser = new DOMParser();
      const doc = parser.parseFromString(wrappedTemplate, "application/xml");
      const result = this.xsltProcessor.transformToFragment(doc, document);
      const serializer = new XMLSerializer();
      let transformed = serializer.serializeToString(result);
      transformed = transformed.replace(/<\/?fx-template>/g, "");
      ComponentsLogger.info("Template transformed via XSLT");
      return transformed;
    } catch (error) {
      ComponentsLogger.error("XSLT transformation failed", error);
      return template;
    }
  }
}
class FXComponentInstance {
  component;
  fx;
  fxPath;
  element = null;
  fxNode = null;
  bindings = /* @__PURE__ */ new Map();
  eventListeners = /* @__PURE__ */ new Map();
  childComponents = /* @__PURE__ */ new Map();
  isHydrated = false;
  constructor(component, fx, fxPath, element) {
    this.component = component;
    this.fx = fx;
    this.fxPath = fxPath;
    this.element = element || null;
    this.init();
  }
  async init() {
    try {
      this.fxNode = this.fx.createNodeProxy(this.fx.setPath(this.fxPath, {}, this.fx.root));
      if (this.component.metadata.fx) {
        this.fxNode.set(this.component.metadata.fx);
      }
      if (this.component.sections.script) {
        await this.executeScript();
      }
      ComponentsLogger.info(`Component instance initialized: ${this.fxPath}`);
    } catch (error) {
      ComponentsLogger.error(`Failed to initialize component: ${this.fxPath}`, error);
      throw error;
    }
  }
  async executeScript() {
    try {
      const scriptContent = this.component.sections.script;
      const context = {
        fx: this.fx,
        node: this.fxNode,
        element: this.element,
        component: this,
        console
      };
      const scriptFunction = new Function(...Object.keys(context), scriptContent);
      const result = scriptFunction.apply(this, Object.values(context));
      if (result && typeof result.then === "function") {
        await result;
      }
      ComponentsLogger.info(`Script executed: ${this.fxPath}`);
    } catch (error) {
      ComponentsLogger.error(`Script execution failed: ${this.fxPath}`, error);
      throw error;
    }
  }
  hydrate(targetElement) {
    if (this.isHydrated) {
      ComponentsLogger.warn(`Component already hydrated: ${this.fxPath}`);
      return this.element;
    }
    try {
      this.element = targetElement || this.createElement();
      if (this.component.sections.template) {
        this.renderTemplate();
      }
      if (this.component.sections.style) {
        this.applyStyles();
      }
      this.setupBindings();
      this.setupEventListeners();
      this.isHydrated = true;
      ComponentsLogger.info(`Component hydrated: ${this.fxPath}`);
      return this.element;
    } catch (error) {
      ComponentsLogger.error(`Hydration failed: ${this.fxPath}`, error);
      throw error;
    }
  }
  createElement() {
    const tagName = this.component.metadata.element || "fx-component";
    const element = document.createElement(tagName);
    element.setAttribute("fx-path", this.fxPath);
    element.setAttribute("fx-component", this.component.metadata.name || "unnamed");
    return element;
  }
  renderTemplate() {
    const parser = new FXCParser();
    let template = this.component.sections.template;
    template = parser.transformTemplate(template, this.component.metadata);
    const rendered = this.interpolateTemplate(template);
    if (this.element) {
      this.element.innerHTML = rendered;
    }
  }
  interpolateTemplate(template) {
    const nodeData = this.fxNode?.val() || {};
    return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
      try {
        const value = this.resolveTemplatePath(path.trim(), nodeData);
        return this.escapeHtml(String(value || ""));
      } catch (error) {
        ComponentsLogger.warn(`Template interpolation failed: ${path}`, error);
        return match;
      }
    });
  }
  resolveTemplatePath(path, data) {
    const keys = path.split(".");
    let current = data;
    for (const key of keys) {
      if (current && typeof current === "object" && key in current) {
        current = current[key];
      } else {
        return void 0;
      }
    }
    return current;
  }
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  applyStyles() {
    const styleContent = this.component.sections.style;
    const scoped = this.component.metadata.scoped !== false;
    let css = styleContent;
    if (scoped) {
      const componentId = `fx-component-${this.fxPath.replace(/[^a-zA-Z0-9]/g, "-")}`;
      this.element.classList.add(componentId);
      css = css.replace(/([^{}]+)\{/g, (match, selector) => {
        return `.${componentId} ${selector.trim()} {`;
      });
    }
    const styleId = `fx-component-styles-${this.fxPath.replace(/[^a-zA-Z0-9]/g, "-")}`;
    let styleElement = document.getElementById(styleId);
    if (!styleElement) {
      styleElement = document.createElement("style");
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = css;
  }
  setupBindings() {
    if (!this.element) return;
    const bindElements = this.element.querySelectorAll("[fx-bind]");
    bindElements.forEach((el) => {
      const bindPath = el.getAttribute("fx-bind");
      const bindType = el.getAttribute("fx-type") || "text";
      const binding = this.createBinding(el, bindPath, bindType);
      this.bindings.set(el, binding);
      const fullPath = `${this.fxPath}.${bindPath}`;
      const node = this.fx.resolvePath(fullPath, this.fx.root);
      if (node) {
        const unwatch = this.fx.createNodeProxy(node).watch((newValue) => {
          binding.update(newValue);
        });
        if (unwatch) {
          binding.unwatch = unwatch;
        }
      }
    });
    const ifElements = this.element.querySelectorAll("[fx-if]");
    ifElements.forEach((el) => {
      const condition = el.getAttribute("fx-if");
      this.setupConditionalBinding(el, condition);
    });
  }
  createBinding(element, path, type) {
    return {
      element,
      path,
      type,
      update: (value) => {
        switch (type) {
          case "text":
            element.textContent = String(value || "");
            break;
          case "html":
            element.innerHTML = String(value || "");
            break;
          case "attr":
            const attrName = element.getAttribute("fx-attr") || "value";
            element.setAttribute(attrName, String(value || ""));
            break;
          case "class":
            element.className = String(value || "");
            break;
          case "style":
            element.style.cssText = String(value || "");
            break;
          default:
            if (type in element) {
              element[type] = value;
            }
        }
      }
    };
  }
  setupConditionalBinding(element, condition) {
    const evaluate = () => {
      try {
        const nodeData = this.fxNode?.val() || {};
        const result = this.evaluateCondition(condition, nodeData);
        element.style.display = result ? "" : "none";
      } catch (error) {
        ComponentsLogger.warn(`Condition evaluation failed: ${condition}`, error);
        element.style.display = "none";
      }
    };
    evaluate();
    if (this.fxNode) {
      const unwatch = this.fxNode.watch(evaluate);
      this.bindings.set(element, {
        element,
        path: condition,
        type: "conditional",
        update: evaluate,
        unwatch: typeof unwatch === "function" ? unwatch : void 0
      });
    }
  }
  evaluateCondition(condition, data) {
    let expression = condition;
    expression = expression.replace(/[\w.]+/g, (match) => {
      if (["true", "false", "null", "undefined"].includes(match)) {
        return match;
      }
      const value = this.resolveTemplatePath(match, data);
      return JSON.stringify(value);
    });
    try {
      return new Function(`return ${expression}`)();
    } catch (error) {
      ComponentsLogger.warn(`Condition evaluation error: ${expression}`, error);
      return false;
    }
  }
  setupEventListeners() {
    if (!this.element) return;
    const allElements = [this.element, ...Array.from(this.element.querySelectorAll("*"))];
    allElements.forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        if (attr.name.startsWith("fx-on-")) {
          const eventType = attr.name.replace("fx-on-", "");
          const actionName = attr.value;
          const handler = (event) => {
            this.executeAction(actionName, event);
          };
          el.addEventListener(eventType, handler);
          if (!this.eventListeners.has(el)) {
            this.eventListeners.set(el, []);
          }
          this.eventListeners.get(el).push({ eventType, handler });
        }
      });
    });
  }
  executeAction(actionName, event) {
    try {
      if (this.component.sections.script) {
        const context = {
          fx: this.fx,
          node: this.fxNode,
          element: this.element,
          component: this,
          event,
          console
        };
        const actionFunction = new Function(...Object.keys(context), `return ${actionName}`);
        const action = actionFunction.apply(this, Object.values(context));
        if (typeof action === "function") {
          action(event);
        }
      }
    } catch (error) {
      ComponentsLogger.error(`Action execution failed: ${actionName}`, error);
    }
  }
  destroy() {
    this.bindings.forEach((binding) => {
      if (binding.unwatch) {
        binding.unwatch();
      }
    });
    this.bindings.clear();
    this.eventListeners.forEach((listeners, element) => {
      listeners.forEach(({ eventType, handler }) => {
        element.removeEventListener(eventType, handler);
      });
    });
    this.eventListeners.clear();
    this.childComponents.forEach((child) => {
      child.destroy();
    });
    this.childComponents.clear();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    ComponentsLogger.info(`Component destroyed: ${this.fxPath}`);
  }
}
class FXComponents {
  fx;
  options;
  name = "components";
  version = "2.0.0";
  description = "Declarative component system with .fxc files";
  parser = new FXCParser();
  componentRegistry = /* @__PURE__ */ new Map();
  instanceRegistry = /* @__PURE__ */ new Map();
  loadingPromises = /* @__PURE__ */ new Map();
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      componentsPath: "/components",
      autoLoadEnabled: true,
      cacheEnabled: true,
      ...options
    };
    this.init();
  }
  init() {
    this.defineCustomElements();
    ComponentsLogger.info("FX Components system initialized");
  }
  defineCustomElements() {
    if (!customElements.get("fx-component")) {
      const ComponentsSystem = this;
      class FXComponentElement extends HTMLElement {
        componentInstance = null;
        async connectedCallback() {
          const src = this.getAttribute("src");
          const fxPath = this.getAttribute("fx-path") || `components.${Date.now()}`;
          if (src) {
            try {
              await ComponentsSystem.loadAndHydrate(src, fxPath, this);
            } catch (error) {
              ComponentsLogger.error(`Failed to load component: ${src}`, error);
            }
          }
        }
        disconnectedCallback() {
          if (this.componentInstance) {
            this.componentInstance.destroy();
            this.componentInstance = null;
          }
        }
      }
      customElements.define("fx-component", FXComponentElement);
    }
  }
  async load(url) {
    if (this.componentRegistry.has(url)) {
      return this.componentRegistry.get(url);
    }
    if (this.loadingPromises.has(url)) {
      return this.loadingPromises.get(url);
    }
    const loadingPromise = this.performLoad(url);
    this.loadingPromises.set(url, loadingPromise);
    try {
      const component = await loadingPromise;
      this.componentRegistry.set(url, component);
      return component;
    } finally {
      this.loadingPromises.delete(url);
    }
  }
  async performLoad(url) {
    try {
      const scout = this.fx.pluginManager?.getByPrefix("scout");
      let content;
      if (scout) {
        const result = await scout.loadFXComponent(url);
        return result;
      } else {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        content = await response.text();
      }
      const component = this.parser.parse(content, url);
      await this.loadDependencies(component);
      return component;
    } catch (error) {
      ComponentsLogger.error(`Failed to load component: ${url}`, error);
      throw error;
    }
  }
  async loadDependencies(component) {
    const promises = component.dependencies.map(async (dep) => {
      try {
        if (dep.type === "component") {
          await this.load(dep.path);
        } else if (dep.type === "module") {
          const scout = this.fx.pluginManager?.getByPrefix("scout");
          if (scout) {
            await scout.loadModule(dep.path);
          }
        }
      } catch (error) {
        ComponentsLogger.warn(`Failed to load dependency: ${dep.path}`, error);
      }
    });
    await Promise.allSettled(promises);
  }
  async create(url, fxPath, element) {
    const component = await this.load(url);
    const instance = new FXComponentInstance(component, this.fx, fxPath, element);
    this.instanceRegistry.set(fxPath, instance);
    return instance;
  }
  async loadAndHydrate(url, fxPath, element) {
    const instance = await this.create(url, fxPath, element);
    const hydratedElement = instance.hydrate(element);
    ComponentsLogger.info(`Component loaded and hydrated: ${url} -> ${fxPath}`);
    return { instance, element: hydratedElement };
  }
  getInstance(fxPath) {
    return this.instanceRegistry.get(fxPath);
  }
  destroyInstance(fxPath) {
    const instance = this.instanceRegistry.get(fxPath);
    if (instance) {
      instance.destroy();
      this.instanceRegistry.delete(fxPath);
      return true;
    }
    return false;
  }
  getRegistry() {
    return {
      components: Array.from(this.componentRegistry.keys()),
      instances: Array.from(this.instanceRegistry.keys())
    };
  }
  clearCache() {
    this.componentRegistry.clear();
    ComponentsLogger.info("Component cache cleared");
  }
}
function stdin_default(fx, options) {
  const components = new FXComponents(fx, options);
  if (typeof globalThis !== "undefined") {
    globalThis.$components = components;
    globalThis.$loadComponent = (url, fxPath, element) => components.loadAndHydrate(url, fxPath, element);
  }
  return components;
}
