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
  default: () => fxApiPlugin
});
module.exports = __toCommonJS(stdin_exports);
class FXAPIPlugin {
  name = "api";
  version = "1.0.0";
  description = "Convenience wrapper for FX core API functionality";
  fx;
  options;
  isRoot;
  constructor(fx, options = {}, isRoot = true) {
    this.fx = fx;
    this.isRoot = isRoot;
    this.options = {
      baseUrl: "",
      headers: {
        "Content-Type": "application/json"
      },
      global: "",
      interceptors: {
        request: [],
        response: []
      },
      ...options
    };
    console.log("FX[API]: Convenience wrapper initialized");
    if (this.isRoot) {
      this.installAPISurface();
    }
  }
  installAPISurface() {
    const api = this.createInstance();
    globalThis.$api = api;
    console.log("FX[API]: $api installed globally");
  }
  buildUrl(url) {
    if (!url.startsWith("/")) {
      url = "/" + url;
    }
    if (this.options.baseUrl) {
      const base = this.options.baseUrl.replace(/\/+$/, "");
      url = base + url;
    }
    return url;
  }
  buildArgs(body, args = {}) {
    const config = {
      headers: {
        ...this.options.headers,
        ...args.headers
      },
      body,
      ...args
    };
    let finalConfig = { ...config, url: this.buildUrl(args.url || "") };
    for (const interceptor of this.options.interceptors.request) {
      finalConfig = interceptor(finalConfig);
    }
    return finalConfig;
  }
  makeRequest(url, method, body, args = {}) {
    const fullUrl = this.buildUrl(url);
    const requestArgs = this.buildArgs(body, args);
    const node = globalThis.$$(`@${fullUrl}`);
    switch (method.toUpperCase()) {
      case "GET":
        return node.get(requestArgs);
      case "POST":
        return node.post(requestArgs);
      case "PUT":
        return node.put(requestArgs);
      case "PATCH":
        return node.patch(requestArgs);
      case "DELETE":
        return node.delete(requestArgs);
      case "FETCH":
        return node.fetch(requestArgs);
      default:
        return node.get(requestArgs);
    }
  }
  createInstance(instanceOptions = {}) {
    const mergedOptions = {
      ...this.options,
      ...instanceOptions,
      headers: {
        ...this.options.headers,
        ...instanceOptions.headers
      },
      interceptors: {
        request: [
          ...this.options.interceptors.request,
          ...instanceOptions.interceptors?.request || []
        ],
        response: [
          ...this.options.interceptors.response,
          ...instanceOptions.interceptors?.response || []
        ]
      }
    };
    const instance = new FXAPIPlugin(this.fx, mergedOptions, false);
    const api = {
      // Direct HTTP methods
      get: (url, args) => instance.makeRequest(url, "GET", void 0, args),
      post: (url, body, args) => instance.makeRequest(url, "POST", body, args),
      put: (url, body, args) => instance.makeRequest(url, "PUT", body, args),
      patch: (url, body, args) => instance.makeRequest(url, "PATCH", body, args),
      delete: (url, args) => instance.makeRequest(url, "DELETE", void 0, args),
      fetch: (url, args) => instance.makeRequest(url, "FETCH", void 0, args),
      // Endpoint builder - returns an object with all HTTP methods for a specific URL
      endpoint: (url) => ({
        get: (args) => instance.makeRequest(url, "GET", void 0, args),
        post: (body, args) => instance.makeRequest(url, "POST", body, args),
        put: (body, args) => instance.makeRequest(url, "PUT", body, args),
        patch: (body, args) => instance.makeRequest(url, "PATCH", body, args),
        delete: (args) => instance.makeRequest(url, "DELETE", void 0, args),
        fetch: (args) => instance.makeRequest(url, "FETCH", void 0, args)
      }),
      // Base URL builder - returns a new API instance with a base URL
      base: (baseUrl) => instance.createInstance({ baseUrl }),
      // Configuration methods
      defaults: (config) => instance.createInstance(config),
      addRequestInterceptor: (interceptor) => instance.createInstance({
        interceptors: {
          request: [...mergedOptions.interceptors.request, interceptor],
          response: mergedOptions.interceptors.response
        }
      }),
      addResponseInterceptor: (interceptor) => instance.createInstance({
        interceptors: {
          request: mergedOptions.interceptors.request,
          response: [...mergedOptions.interceptors.response, interceptor]
        }
      }),
      // Direct FX core access - escape hatch to use FX's @/api syntax directly
      fx: (url) => globalThis.$$(`@${instance.buildUrl(url)}`)
    };
    return api;
  }
}
function fxApiPlugin(fx, options = {}) {
  const plugin = new FXAPIPlugin(fx, options);
  return plugin.createInstance();
}
