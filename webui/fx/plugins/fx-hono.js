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
  default: () => fxHonoPlugin,
  setupFXWithHono: () => setupFXWithHono
});
module.exports = __toCommonJS(stdin_exports);
class FXHonoPlugin {
  name = "fx-hono";
  version = "1.0.0";
  description = "Hono integration for FX server routes";
  fx;
  options;
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      basePath: "/fx",
      corsEnabled: true,
      enableProxy: true,
      enableModule: true,
      enableHealth: true,
      allowedOrigins: ["*"],
      ...options
    };
    console.log("\u{1F680} FX-Hono integration initialized");
  }
  /**
   * Mount FX routes into Hono app
   */
  mount(app) {
    const routes = this.createServerRoutes();
    if (this.options.corsEnabled) {
      app.use(`${this.options.basePath}/*`, this.corsMiddleware.bind(this));
    }
    if (this.options.enableHealth) {
      app.get(`${this.options.basePath}/health`, routes.health);
    }
    if (this.options.enableProxy) {
      app.all(`${this.options.basePath}/proxy`, routes.proxy);
    }
    if (this.options.enableModule) {
      app.get(`${this.options.basePath}/module`, routes.module);
    }
    app.post(`${this.options.basePath}/flow/execute`, async (c) => {
      try {
        const body = await c.req.json();
        console.log("[FX-Hono] Flow execution request received");
        const { flow, node, payload, serializedFlow } = body;
        console.log("[FX-Hono] Flow path:", flow);
        console.log("[FX-Hono] Node name:", node);
        console.log("[FX-Hono] Has serialized flow:", !!serializedFlow);
        const fx = globalThis.fx;
        const serializePlugin = globalThis.__fxPlugins?.serialize;
        const flowPlugin = globalThis.$flowPlugin;
        if (!fx) {
          console.error("[FX-Hono] ERROR: FX instance not available");
          return c.json({ error: "FX instance not available on server" }, 500);
        }
        if (!flowPlugin) {
          console.error("[FX-Hono] ERROR: Flow plugin not loaded");
          return c.json({ error: "fx-flow not loaded on server" }, 500);
        }
        let flowNode = fx.resolvePath(flow, fx.root);
        if (!flowNode && serializedFlow && serializePlugin) {
          console.log("[FX-Hono] Flow not found, deserializing from client...");
          try {
            const flowParts = flow.split(".");
            let targetNode = fx.root;
            for (let i = 0; i < flowParts.length - 1; i++) {
              const part = flowParts[i];
              if (!targetNode.__nodes) targetNode.__nodes = /* @__PURE__ */ Object.create(null);
              if (!targetNode.__nodes[part]) {
                targetNode.__nodes[part] = fx.createNode(targetNode.__id);
              }
              targetNode = targetNode.__nodes[part];
            }
            const lastPart = flowParts[flowParts.length - 1];
            if (!targetNode.__nodes) targetNode.__nodes = /* @__PURE__ */ Object.create(null);
            if (!targetNode.__nodes[lastPart]) {
              targetNode.__nodes[lastPart] = fx.createNode(targetNode.__id);
            }
            flowNode = serializePlugin.expand(serializedFlow, targetNode.__nodes[lastPart]);
            console.log("[FX-Hono] Flow deserialized successfully");
          } catch (error) {
            console.error("[FX-Hono] Failed to deserialize flow:", error);
            return c.json({ error: `Failed to deserialize flow: ${error.message}` }, 500);
          }
        }
        if (!flowNode) {
          console.error("[FX-Hono] ERROR: Flow not found and no serialized data provided");
          return c.json({ error: `Flow ${flow} not found on server and no serialized data provided` }, 500);
        }
        console.log("[FX-Hono] Enqueueing node for execution:", node);
        flowPlugin._enqueue(flow, node, payload);
        flowPlugin._pump(flow);
        console.log("[FX-Hono] Node executed successfully");
        return c.json({ ok: true, result: payload });
      } catch (error) {
        console.error("[FX-Hono] Flow execution error:", error);
        console.error("[FX-Hono] Error stack:", error.stack);
        return c.json({ error: String(error?.message || error), stack: error.stack }, 500);
      }
    });
    app.get(this.options.basePath, routes.info);
    console.log(`\u2705 FX routes mounted at ${this.options.basePath}`);
  }
  /**
   * Create FX server route handlers (extracted from fx.ts)
   */
  createServerRoutes() {
    return {
      health: (c) => {
        return c.json({ ok: true, time: (/* @__PURE__ */ new Date()).toISOString() });
      },
      proxy: async (c) => {
        const target = c.req.query("url");
        if (!target) {
          return c.json({ error: "Missing url parameter" }, 400);
        }
        try {
          const body = await this.extractRequestBody(c);
          const headers = new Headers(c.req.raw.headers);
          headers.delete("host");
          headers.delete("origin");
          headers.delete("referer");
          headers.delete("cookie");
          const response = await fetch(target, {
            method: c.req.method,
            headers,
            body: body?.raw
          });
          const responseHeaders = new Headers(response.headers);
          responseHeaders.set("content-type", response.headers.get("content-type") || "application/octet-stream");
          return new Response(await response.arrayBuffer(), {
            status: response.status,
            headers: responseHeaders
          });
        } catch (error) {
          console.error("FX Proxy error:", error);
          return c.json({ error: String(error?.message || error) }, 500);
        }
      },
      module: async (c) => {
        const target = c.req.query("url");
        if (!target) {
          return c.json({ error: "Missing url parameter" }, 400);
        }
        try {
          const response = await fetch(target);
          if (!response.ok) {
            return c.json({ error: `Upstream ${response.status}` }, response.status);
          }
          const code = await response.text();
          return new Response(code, {
            status: 200,
            headers: new Headers({
              "content-type": "application/javascript; charset=utf-8"
            })
          });
        } catch (error) {
          console.error("FX Module error:", error);
          return c.json({ error: String(error?.message || error) }, 500);
        }
      },
      info: (c) => {
        return c.json({
          fx: "online",
          version: this.fx.version || "1.0.0",
          hono: "integrated",
          endpoints: {
            health: `${this.options.basePath}/health`,
            proxy: `${this.options.basePath}/proxy?url=<encoded>`,
            module: `${this.options.basePath}/module?url=<encoded>`
          },
          features: {
            cors: this.options.corsEnabled,
            proxy: this.options.enableProxy,
            moduleLoading: this.options.enableModule
          }
        });
      }
    };
  }
  /**
   * CORS middleware for FX routes
   */
  async corsMiddleware(c, next) {
    if (c.req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: this.getCORSHeaders(c)
      });
    }
    await next();
    const corsHeaders = this.getCORSHeaders(c);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      c.res.headers.set(key, value);
    });
  }
  /**
   * Get CORS headers based on configuration
   */
  getCORSHeaders(c) {
    const origin = c.req.header("origin") || "*";
    const allowedOrigin = this.options.allowedOrigins.includes("*") || this.options.allowedOrigins.includes(origin) ? origin : "null";
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
      "Access-Control-Allow-Credentials": "false",
      // Security: no credentials
      "Access-Control-Max-Age": "86400"
      // 24 hours
    };
  }
  /**
   * Extract request body for proxy forwarding
   */
  async extractRequestBody(c) {
    const contentType = c.req.header("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        const json = await c.req.json().catch(() => ({}));
        return { raw: JSON.stringify(json) };
      }
      if (contentType.includes("text/")) {
        const text = await c.req.text();
        return { raw: text };
      }
      if (contentType.includes("form")) {
        const formData = await c.req.formData();
        const params = new URLSearchParams();
        formData.forEach((value, key) => {
          params.append(key, value.toString());
        });
        return { raw: params.toString() };
      }
      const arrayBuffer = await c.req.arrayBuffer();
      return { raw: new Uint8Array(arrayBuffer) };
    } catch (error) {
      console.warn("Failed to extract request body:", error);
      return null;
    }
  }
  /**
   * Create middleware for FX-Flow cross-realm execution
   */
  createFlowMiddleware() {
    return async (c, next) => {
      c.set("fx", this.fx);
      c.set("fxHono", this);
      await next();
    };
  }
  /**
   * Add custom FX routes to Hono
   */
  addCustomRoutes(app, routes) {
    Object.entries(routes).forEach(([path, handler]) => {
      app.all(`${this.options.basePath}${path}`, async (c) => {
        try {
          const result = await handler(c, this.fx);
          return typeof result === "object" && result.constructor === Response ? result : c.json(result);
        } catch (error) {
          console.error(`FX custom route error (${path}):`, error);
          return c.json({ error: error.message }, 500);
        }
      });
    });
  }
}
function fxHonoPlugin(fx, options = {}) {
  return new FXHonoPlugin(fx, options);
}
function setupFXWithHono(app, fx, options = {}) {
  const fxHono = new FXHonoPlugin(fx, options);
  fxHono.mount(app);
  app.use("*", fxHono.createFlowMiddleware());
  return fxHono;
}
