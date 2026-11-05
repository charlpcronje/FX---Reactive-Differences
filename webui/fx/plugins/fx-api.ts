// /plugins/fx-api.ts
/**
 * @fx-plugin fx-api
 * @fx-global $api
 * @fx-description Convenience wrapper over FX core's built-in API support
 * @fx-dependencies
 * @fx-provides $api
 * @fx-version 1.0.0
 *
 * FX API Plugin - Convenience wrapper over FX core's built-in API support
 *
 * This plugin provides a clean abstraction over FX's native @/api/ syntax
 * while preserving FX's core principle of zero async contamination.
 *
 * Features:
 * - All HTTP verbs (GET, POST, PUT, PATCH, DELETE)
 * - Base URL configuration
 * - Request interceptors
 * - Convenience methods
 * - 100% synchronous surface (uses FX's FutureProxy internally)
 */

import type { FXCore as FX, FXNodeProxy } from "../fx.v4";

type FXN = FXNodeProxy<any, any>;

interface HttpArgs {
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  global?: string;
}

interface APIOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  global?: string;
  interceptors?: {
    request?: RequestInterceptor[];
    response?: ResponseInterceptor[];
  };
}

interface RequestInterceptor {
  (config: HttpArgs & { url: string }): HttpArgs & { url: string };
}

interface ResponseInterceptor {
  (response: any, config: HttpArgs & { url: string }): any;
}

interface EndpointBuilder {
  get(args?: HttpArgs): FXN;
  post(body?: any, args?: HttpArgs): FXN;
  put(body?: any, args?: HttpArgs): FXN;
  patch(body?: any, args?: HttpArgs): FXN;
  delete(args?: HttpArgs): FXN;
  fetch(args?: HttpArgs): FXN;
}

interface APIInstance {
  // Direct methods
  get(url: string, args?: HttpArgs): FXN;
  post(url: string, body?: any, args?: HttpArgs): FXN;
  put(url: string, body?: any, args?: HttpArgs): FXN;
  patch(url: string, body?: any, args?: HttpArgs): FXN;
  delete(url: string, args?: HttpArgs): FXN;
  fetch(url: string, args?: HttpArgs): FXN;

  // Endpoint builder
  endpoint(url: string): EndpointBuilder;

  // Base URL builder
  base(baseUrl: string): APIInstance;

  // Configuration
  defaults(config: Partial<APIOptions>): APIInstance;
  addRequestInterceptor(interceptor: RequestInterceptor): APIInstance;
  addResponseInterceptor(interceptor: ResponseInterceptor): APIInstance;

  // Direct FX core access
  fx(url: string): FXN;
}

/**
 * @class FXAPIPlugin
 * @description Convenience wrapper over FX core's native API support
 */
class FXAPIPlugin {
  public readonly name = 'api';
  public readonly version = '1.0.0';
  public readonly description = 'Convenience wrapper for FX core API functionality';

  private fx: FX;
  private options: Required<APIOptions>;
  private isRoot: boolean;

  constructor(fx: FX, options: APIOptions = {}, isRoot: boolean = true) {
    this.fx = fx;
    this.isRoot = isRoot;
    this.options = {
      baseUrl: '',
      headers: {
        'Content-Type': 'application/json'
      },
      global: '',
      interceptors: {
        request: [],
        response: []
      },
      ...options
    };

    console.log('FX[API]: Convenience wrapper initialized');

    // Only install API surface for root instance
    if (this.isRoot) {
      this.installAPISurface();
    }
  }

  private installAPISurface() {
    // Create the API instance and set it globally
    const api = this.createInstance();
    (globalThis as any).$api = api;
    console.log('FX[API]: $api installed globally');
  }

  private buildUrl(url: string): string {
    // Ensure URL starts with / for FX's @/api syntax
    if (!url.startsWith('/')) {
      url = '/' + url;
    }

    // Apply base URL if configured
    if (this.options.baseUrl) {
      const base = this.options.baseUrl.replace(/\/+$/, '');
      url = base + url;
    }

    return url;
  }

  private buildArgs(body?: any, args: HttpArgs = {}): HttpArgs {
    const config = {
      headers: {
        ...this.options.headers,
        ...args.headers
      },
      body,
      ...args
    };

    // Apply request interceptors
    let finalConfig = { ...config, url: this.buildUrl(args.url || '') };
    for (const interceptor of this.options.interceptors.request) {
      finalConfig = interceptor(finalConfig);
    }

    return finalConfig;
  }

  private makeRequest(url: string, method: string, body?: any, args: HttpArgs = {}): FXN {
    const fullUrl = this.buildUrl(url);
    const requestArgs = this.buildArgs(body, args);

    // Use FX core's built-in @/api syntax - this preserves FX's sync surface
    const node = (globalThis as any).$$(`@${fullUrl}`);

    // Call the appropriate HTTP method on the FX node
    switch (method.toUpperCase()) {
      case 'GET':
        return node.get(requestArgs);
      case 'POST':
        return node.post(requestArgs);
      case 'PUT':
        return node.put(requestArgs);
      case 'PATCH':
        return node.patch(requestArgs);
      case 'DELETE':
        return node.delete(requestArgs);
      case 'FETCH':
        return node.fetch(requestArgs);
      default:
        return node.get(requestArgs);
    }
  }

  public createInstance(instanceOptions: APIOptions = {}): APIInstance {
    // Merge options for this instance
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
          ...(instanceOptions.interceptors?.request || [])
        ],
        response: [
          ...this.options.interceptors.response,
          ...(instanceOptions.interceptors?.response || [])
        ]
      }
    };

    // Create a new plugin instance with merged options (not root to avoid reinstalling)
    const instance = new FXAPIPlugin(this.fx, mergedOptions, false);

    const api: APIInstance = {
      // Direct HTTP methods
      get: (url: string, args?: HttpArgs) => instance.makeRequest(url, 'GET', undefined, args),
      post: (url: string, body?: any, args?: HttpArgs) => instance.makeRequest(url, 'POST', body, args),
      put: (url: string, body?: any, args?: HttpArgs) => instance.makeRequest(url, 'PUT', body, args),
      patch: (url: string, body?: any, args?: HttpArgs) => instance.makeRequest(url, 'PATCH', body, args),
      delete: (url: string, args?: HttpArgs) => instance.makeRequest(url, 'DELETE', undefined, args),
      fetch: (url: string, args?: HttpArgs) => instance.makeRequest(url, 'FETCH', undefined, args),

      // Endpoint builder - returns an object with all HTTP methods for a specific URL
      endpoint: (url: string): EndpointBuilder => ({
        get: (args?: HttpArgs) => instance.makeRequest(url, 'GET', undefined, args),
        post: (body?: any, args?: HttpArgs) => instance.makeRequest(url, 'POST', body, args),
        put: (body?: any, args?: HttpArgs) => instance.makeRequest(url, 'PUT', body, args),
        patch: (body?: any, args?: HttpArgs) => instance.makeRequest(url, 'PATCH', body, args),
        delete: (args?: HttpArgs) => instance.makeRequest(url, 'DELETE', undefined, args),
        fetch: (args?: HttpArgs) => instance.makeRequest(url, 'FETCH', undefined, args)
      }),

      // Base URL builder - returns a new API instance with a base URL
      base: (baseUrl: string): APIInstance => instance.createInstance({ baseUrl }),

      // Configuration methods
      defaults: (config: Partial<APIOptions>): APIInstance => instance.createInstance(config),

      addRequestInterceptor: (interceptor: RequestInterceptor): APIInstance =>
        instance.createInstance({
          interceptors: {
            request: [...mergedOptions.interceptors.request, interceptor],
            response: mergedOptions.interceptors.response
          }
        }),

      addResponseInterceptor: (interceptor: ResponseInterceptor): APIInstance =>
        instance.createInstance({
          interceptors: {
            request: mergedOptions.interceptors.request,
            response: [...mergedOptions.interceptors.response, interceptor]
          }
        }),

      // Direct FX core access - escape hatch to use FX's @/api syntax directly
      fx: (url: string): FXN => (globalThis as any).$$(`@${instance.buildUrl(url)}`)
    };

    return api;
  }
}

// Plugin factory function
export default function fxApiPlugin(fx: FX, options: APIOptions = {}): APIInstance {
  const plugin = new FXAPIPlugin(fx, options);
  // The plugin already installed $api globally in its constructor
  return plugin.createInstance();
}

// Export types for external use
export type {
  APIInstance,
  APIOptions,
  HttpArgs,
  RequestInterceptor,
  ResponseInterceptor,
  EndpointBuilder
};