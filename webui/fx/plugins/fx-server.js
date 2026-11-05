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
  FXServer: () => FXServer,
  Router: () => Router,
  default: () => createFXServer,
  responses: () => responses
});
module.exports = __toCommonJS(stdin_exports);
class FXServer {
  fx;
  config;
  routes = [];
  middleware = [];
  server;
  wsHandlers = /* @__PURE__ */ new Map();
  // FX nodes
  $server;
  $routes;
  $middleware;
  $stats;
  constructor(fx, config) {
    this.fx = fx;
    this.config = config;
    this.$server = fx.proxy("server");
    this.$routes = fx.proxy("server.routes");
    this.$middleware = fx.proxy("server.middleware");
    this.$stats = fx.proxy("server.stats");
    this.$stats.val({
      requests: 0,
      errors: 0,
      avgResponseTime: 0,
      activeConnections: 0
    });
    this.setupDefaultMiddleware();
  }
  /**
   * Setup default middleware
   */
  setupDefaultMiddleware() {
    if (this.config.cors) {
      this.use(this.corsMiddleware());
    }
    this.use(this.bodyParserMiddleware());
    this.use(this.queryParserMiddleware());
  }
  /**
   * CORS middleware
   */
  corsMiddleware() {
    return async (ctx) => {
      const corsConfig = typeof this.config.cors === "object" ? this.config.cors : {};
      const origin = ctx.request.headers.get("origin").val() || "*";
      const allowedOrigin = corsConfig.origin || "*";
      ctx.response.headers.set(
        "Access-Control-Allow-Origin",
        typeof allowedOrigin === "function" ? allowedOrigin(origin) ? origin : "" : allowedOrigin
      );
      if (corsConfig.credentials) {
        ctx.response.headers.set("Access-Control-Allow-Credentials", "true");
      }
      if (ctx.request.method.val() === "OPTIONS") {
        ctx.response.headers.set(
          "Access-Control-Allow-Methods",
          (corsConfig.methods || ["GET", "POST", "PUT", "DELETE", "OPTIONS"]).join(", ")
        );
        ctx.response.headers.set(
          "Access-Control-Allow-Headers",
          (corsConfig.headers || ["Content-Type", "Authorization"]).join(", ")
        );
        ctx.response.status(204).send();
        return;
      }
      await ctx.next();
    };
  }
  /**
   * Body parser middleware
   */
  bodyParserMiddleware() {
    return async (ctx) => {
      const contentType = ctx.request.headers.get("content-type").val() || "";
      if (contentType.includes("application/json")) {
        try {
          const rawBody = await this.readBody(ctx.request);
          ctx.request.body.val(JSON.parse(rawBody));
        } catch (error) {
          ctx.request.body.val({});
        }
      } else if (contentType.includes("application/x-www-form-urlencoded")) {
        const rawBody = await this.readBody(ctx.request);
        const parsed = new URLSearchParams(rawBody);
        const body = {};
        for (const [key, value] of parsed) {
          body[key] = value;
        }
        ctx.request.body.val(body);
      } else if (contentType.includes("multipart/form-data")) {
        ctx.request.body.val({ _multipart: true });
      } else {
        const rawBody = await this.readBody(ctx.request);
        ctx.request.body.val(rawBody);
      }
      await ctx.next();
    };
  }
  /**
   * Query parser middleware
   */
  queryParserMiddleware() {
    return async (ctx) => {
      const url = new URL(ctx.request.url.val(), `http://${this.config.host || "localhost"}`);
      const query = {};
      for (const [key, value] of url.searchParams) {
        if (query[key]) {
          if (Array.isArray(query[key])) {
            query[key].push(value);
          } else {
            query[key] = [query[key], value];
          }
        } else {
          query[key] = value;
        }
      }
      ctx.request.query.val(query);
      ctx.query.val(query);
      await ctx.next();
    };
  }
  /**
   * Read request body
   */
  async readBody(request) {
    return "";
  }
  /**
   * Add middleware
   */
  use(middleware) {
    this.middleware.push(middleware);
    this.$middleware.set(this.middleware.length - 1, {
      fn: middleware.toString(),
      added: (/* @__PURE__ */ new Date()).toISOString()
    });
    return this;
  }
  /**
   * Add route
   */
  route(path, method, ...handlers) {
    const methods = Array.isArray(method) ? method : [method];
    const params = [];
    const regexPath = path.replace(/:([^/]+)/g, (_, param) => {
      params.push(param);
      return "([^/]+)";
    });
    const route = {
      method: methods,
      path,
      handlers,
      params
    };
    this.routes.push(route);
    this.$routes.set(path, {
      methods,
      handlers: handlers.length,
      params
    });
    return this;
  }
  /**
   * Convenience methods for HTTP verbs
   */
  get(path, ...handlers) {
    return this.route(path, "GET", ...handlers);
  }
  post(path, ...handlers) {
    return this.route(path, "POST", ...handlers);
  }
  put(path, ...handlers) {
    return this.route(path, "PUT", ...handlers);
  }
  delete(path, ...handlers) {
    return this.route(path, "DELETE", ...handlers);
  }
  patch(path, ...handlers) {
    return this.route(path, "PATCH", ...handlers);
  }
  head(path, ...handlers) {
    return this.route(path, "HEAD", ...handlers);
  }
  options(path, ...handlers) {
    return this.route(path, "OPTIONS", ...handlers);
  }
  all(path, ...handlers) {
    return this.route(path, ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"], ...handlers);
  }
  /**
   * WebSocket support
   */
  ws(path, handler) {
    this.wsHandlers.set(path, handler);
    return this;
  }
  /**
   * Static file serving
   */
  static(prefix = "/static", dir = "./public") {
    this.get(`${prefix}/*`, async (ctx) => {
      const path = ctx.request.path.val().slice(prefix.length);
      ctx.response.status(404).text("Not Found");
    });
    return this;
  }
  /**
   * Find matching route
   */
  findRoute(method, path) {
    for (const route of this.routes) {
      if (!route.method.includes(method)) continue;
      if (route.path === path) {
        return { route, params: {} };
      }
      if (route.params && route.params.length > 0) {
        const pattern = route.path.replace(/:([^/]+)/g, "([^/]+)");
        const regex = new RegExp(`^${pattern}$`);
        const match = path.match(regex);
        if (match) {
          const params = {};
          route.params.forEach((param, index) => {
            params[param] = match[index + 1];
          });
          return { route, params };
        }
      }
    }
    return null;
  }
  /**
   * Handle incoming request
   */
  async handleRequest(req, res) {
    const stats = this.$stats.val();
    stats.requests++;
    stats.activeConnections++;
    this.$stats.val(stats);
    const startTime = Date.now();
    const ctx = this.createContext(req, res);
    try {
      let middlewareIndex = 0;
      const next = async () => {
        if (middlewareIndex < this.middleware.length) {
          const mw = this.middleware[middlewareIndex++];
          await mw(ctx);
        } else {
          const routeMatch = this.findRoute(
            ctx.request.method.val(),
            ctx.request.path.val()
          );
          if (routeMatch) {
            ctx.params.val(routeMatch.params);
            ctx.request.params.val(routeMatch.params);
            for (const handler of routeMatch.route.handlers) {
              await handler(ctx);
            }
          } else {
            ctx.response.status(404).text("Not Found");
          }
        }
      };
      ctx.next = next;
      await next();
      if (!res.headersSent) {
        ctx.response.send();
      }
    } catch (error) {
      console.error("Server error:", error);
      stats.errors++;
      if (!res.headersSent) {
        ctx.response.status(500).json({
          error: "Internal Server Error",
          message: error instanceof Error ? error.message : "Unknown error"
        });
      }
    } finally {
      stats.activeConnections--;
      const responseTime = Date.now() - startTime;
      stats.avgResponseTime = (stats.avgResponseTime * (stats.requests - 1) + responseTime) / stats.requests;
      this.$stats.val(stats);
    }
  }
  /**
   * Create FX context for request
   */
  createContext(req, res) {
    const url = new URL(req.url || "/", `http://${this.config.host || "localhost"}`);
    const request = {
      method: this.fx.proxy("server.request.method").val(req.method || "GET"),
      url: this.fx.proxy("server.request.url").val(req.url || "/"),
      path: this.fx.proxy("server.request.path").val(url.pathname),
      headers: this.fx.proxy("server.request.headers").val(req.headers || {}),
      body: this.fx.proxy("server.request.body").val({}),
      query: this.fx.proxy("server.request.query").val({}),
      params: this.fx.proxy("server.request.params").val({}),
      cookies: this.fx.proxy("server.request.cookies").val({}),
      ip: this.fx.proxy("server.request.ip").val(req.socket?.remoteAddress || "")
    };
    const responseHeaders = this.fx.proxy("server.response.headers").val({});
    const responseBody = this.fx.proxy("server.response.body").val("");
    const responseStatus = this.fx.proxy("server.response.status").val(200);
    const response = {
      status: (code) => {
        responseStatus.val(code);
        return response;
      },
      headers: responseHeaders,
      body: responseBody,
      json: (data) => {
        responseHeaders.set("Content-Type", "application/json");
        responseBody.val(JSON.stringify(data));
        return response;
      },
      text: (text) => {
        responseHeaders.set("Content-Type", "text/plain");
        responseBody.val(text);
        return response;
      },
      html: (html) => {
        responseHeaders.set("Content-Type", "text/html");
        responseBody.val(html);
        return response;
      },
      redirect: (url2, code = 302) => {
        responseStatus.val(code);
        responseHeaders.set("Location", url2);
        return response;
      },
      cookie: (name, value, options = {}) => {
        const cookieStr = `${name}=${value}; ${Object.entries(options).map(([k, v]) => `${k}=${v}`).join("; ")}`;
        const existingCookies = responseHeaders.get("Set-Cookie").val();
        if (existingCookies) {
          responseHeaders.set(
            "Set-Cookie",
            Array.isArray(existingCookies) ? [...existingCookies, cookieStr] : [existingCookies, cookieStr]
          );
        } else {
          responseHeaders.set("Set-Cookie", cookieStr);
        }
        return response;
      },
      send: () => {
        res.statusCode = responseStatus.val();
        const headers = responseHeaders.val();
        for (const [key, value] of Object.entries(headers)) {
          res.setHeader(key, value);
        }
        res.end(responseBody.val());
      }
    };
    return {
      request,
      response,
      params: this.fx.proxy("server.context.params").val({}),
      query: this.fx.proxy("server.context.query").val({}),
      state: this.fx.proxy("server.context.state").val({}),
      next: async () => {
      }
    };
  }
  /**
   * Start the server
   */
  async listen(callback) {
    const { port, host = "localhost" } = this.config;
    if (typeof globalThis.Deno !== "undefined") {
      this.server = Deno.serve({
        port,
        hostname: host,
        handler: async (req) => {
          const fakeRes = {
            statusCode: 200,
            headers: /* @__PURE__ */ new Map(),
            setHeader: (key, value) => {
              this.headers.set(key, value);
            },
            end: (body) => {
              return new Response(body, {
                status: this.statusCode,
                headers: Object.fromEntries(this.headers)
              });
            },
            headersSent: false
          };
          await this.handleRequest(req, fakeRes);
          return fakeRes;
        }
      });
    } else if (typeof process !== "undefined") {
      const http = require("http");
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });
      this.server.listen(port, host, () => {
        console.log(`[FX Server] Listening on http://${host}:${port}`);
        if (callback) callback();
      });
    }
    this.$server.set("status", "running");
    this.$server.set("port", port);
    this.$server.set("host", host);
    return this;
  }
  /**
   * Stop the server
   */
  async stop() {
    if (this.server) {
      if (typeof globalThis.Deno !== "undefined") {
        this.server = null;
      } else if (typeof process !== "undefined") {
        this.server.close();
      }
    }
    this.$server.set("status", "stopped");
  }
}
function createFXServer(fx) {
  const serverFactory = {
    create: (config) => new FXServer(fx, config),
    // Quick server creation
    quickStart: (port = 3e3, handler) => {
      const server = new FXServer(fx, { port });
      if (handler) {
        server.all("*", handler);
      }
      return server;
    },
    // Express-like API
    express: () => {
      const server = new FXServer(fx, { port: 3e3, cors: true });
      server.locals = fx.proxy("server.locals").val({});
      return server;
    }
  };
  fx.pluginManager.register("server", serverFactory, { global: "$server" });
  return serverFactory;
}
class Router {
  routes = [];
  prefix;
  constructor(prefix = "") {
    this.prefix = prefix;
  }
  route(path, method, ...handlers) {
    const fullPath = this.prefix + path;
    this.routes.push({
      method: Array.isArray(method) ? method : [method],
      path: fullPath,
      handlers,
      params: []
    });
    return this;
  }
  get(path, ...handlers) {
    return this.route(path, "GET", ...handlers);
  }
  post(path, ...handlers) {
    return this.route(path, "POST", ...handlers);
  }
  mount(server) {
    for (const route of this.routes) {
      server.route(route.path, route.method, ...route.handlers);
    }
  }
}
const responses = {
  ok: (data) => ({ status: 200, data }),
  created: (data) => ({ status: 201, data }),
  accepted: (data) => ({ status: 202, data }),
  noContent: () => ({ status: 204 }),
  badRequest: (message) => ({ status: 400, error: message }),
  unauthorized: (message = "Unauthorized") => ({ status: 401, error: message }),
  forbidden: (message = "Forbidden") => ({ status: 403, error: message }),
  notFound: (message = "Not Found") => ({ status: 404, error: message }),
  serverError: (message = "Internal Server Error") => ({ status: 500, error: message })
};
