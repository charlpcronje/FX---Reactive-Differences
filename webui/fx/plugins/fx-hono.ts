// /plugins/fx-hono.ts
/**
 * @fx-plugin fx-hono
 * @fx-global $hono
 * @fx-description Hono integration plugin for mounting FX server routes
 * @fx-dependencies
 * @fx-provides $hono
 * @fx-version 1.0.0
 *
 * FX-Hono Integration Plugin
 *
 * Mounts FX's essential server routes into your Hono app:
 * - /fx/proxy - CORS-safe cross-origin API calls
 * - /fx/module - Module loading for sync imports
 * - /fx/health - Health check endpoint
 * - Cross-realm execution support for fx-flow
 * - Database proxying for fx-orm
 */

import type { FXCore as FX } from "../fx.v4";
import type { Hono, Context, Next } from "hono";

interface FXHonoOptions {
  basePath?: string;          // Default: '/fx'
  corsEnabled?: boolean;      // Default: true
  enableProxy?: boolean;      // Default: true
  enableModule?: boolean;     // Default: true
  enableHealth?: boolean;     // Default: true
  allowedOrigins?: string[];  // CORS origins
}

interface FXServerRoutes {
  proxy: (c: Context) => Promise<Response>;
  module: (c: Context) => Promise<Response>;
  health: (c: Context) => Response;
  info: (c: Context) => Response;
}

/**
 * @class FXHonoPlugin
 * @description Integrates FX server functionality into Hono apps
 */
class FXHonoPlugin {
  public readonly name = 'fx-hono';
  public readonly version = '1.0.0';
  public readonly description = 'Hono integration for FX server routes';

  private fx: FX;
  private options: Required<FXHonoOptions>;

  constructor(fx: FX, options: FXHonoOptions = {}) {
    this.fx = fx;
    this.options = {
      basePath: '/fx',
      corsEnabled: true,
      enableProxy: true,
      enableModule: true,
      enableHealth: true,
      allowedOrigins: ['*'],
      ...options
    };

    console.log('🚀 FX-Hono integration initialized');
  }

  /**
   * Mount FX routes into Hono app
   */
  public mount(app: Hono): void {
    const routes = this.createServerRoutes();

    // Add CORS middleware if enabled
    if (this.options.corsEnabled) {
      app.use(`${this.options.basePath}/*`, this.corsMiddleware.bind(this));
    }

    // Mount FX routes
    if (this.options.enableHealth) {
      app.get(`${this.options.basePath}/health`, routes.health);
    }

    if (this.options.enableProxy) {
      app.all(`${this.options.basePath}/proxy`, routes.proxy);
    }

    if (this.options.enableModule) {
      app.get(`${this.options.basePath}/module`, routes.module);
    }

    // Flow execution bridge for cross-realm
    app.post(`${this.options.basePath}/flow/execute`, async (c: Context) => {
      try {
        const body = await c.req.json();
        console.log('[FX-Hono] Flow execution request received');

        const { flow, node, payload, serializedFlow } = body;

        console.log('[FX-Hono] Flow path:', flow);
        console.log('[FX-Hono] Node name:', node);
        console.log('[FX-Hono] Has serialized flow:', !!serializedFlow);

        const fx = (globalThis as any).fx;
        const serializePlugin = (globalThis as any).__fxPlugins?.serialize;
        const flowPlugin = (globalThis as any).$flowPlugin;

        if (!fx) {
          console.error('[FX-Hono] ERROR: FX instance not available');
          return c.json({ error: 'FX instance not available on server' }, 500);
        }

        if (!flowPlugin) {
          console.error('[FX-Hono] ERROR: Flow plugin not loaded');
          return c.json({ error: 'fx-flow not loaded on server' }, 500);
        }

        // Check if flow exists on server
        let flowNode = fx.resolvePath(flow, fx.root);

        // If flow doesn't exist and we have serialized data, hydrate it
        if (!flowNode && serializedFlow && serializePlugin) {
          console.log('[FX-Hono] Flow not found, deserializing from client...');

          try {
            // Create the flow node path
            const flowParts = flow.split('.');
            let targetNode = fx.root;

            // Navigate/create the path to where the flow should be
            for (let i = 0; i < flowParts.length - 1; i++) {
              const part = flowParts[i];
              if (!targetNode.__nodes) targetNode.__nodes = Object.create(null);
              if (!targetNode.__nodes[part]) {
                targetNode.__nodes[part] = fx.createNode(targetNode.__id);
              }
              targetNode = targetNode.__nodes[part];
            }

            // Now deserialize the flow into the target location
            const lastPart = flowParts[flowParts.length - 1];
            if (!targetNode.__nodes) targetNode.__nodes = Object.create(null);
            if (!targetNode.__nodes[lastPart]) {
              targetNode.__nodes[lastPart] = fx.createNode(targetNode.__id);
            }

            flowNode = serializePlugin.expand(serializedFlow, targetNode.__nodes[lastPart]);
            console.log('[FX-Hono] Flow deserialized successfully');
          } catch (error: any) {
            console.error('[FX-Hono] Failed to deserialize flow:', error);
            return c.json({ error: `Failed to deserialize flow: ${error.message}` }, 500);
          }
        }

        if (!flowNode) {
          console.error('[FX-Hono] ERROR: Flow not found and no serialized data provided');
          return c.json({ error: `Flow ${flow} not found on server and no serialized data provided` }, 500);
        }

        // Enqueue and execute the node
        console.log('[FX-Hono] Enqueueing node for execution:', node);
        flowPlugin._enqueue(flow, node, payload);
        flowPlugin._pump(flow);
        console.log('[FX-Hono] Node executed successfully');

        return c.json({ ok: true, result: payload });
      } catch (error: any) {
        console.error('[FX-Hono] Flow execution error:', error);
        console.error('[FX-Hono] Error stack:', error.stack);
        return c.json({ error: String(error?.message || error), stack: error.stack }, 500);
      }
    });

    // Info endpoint
    app.get(this.options.basePath, routes.info);

    console.log(`✅ FX routes mounted at ${this.options.basePath}`);
  }

  /**
   * Create FX server route handlers (extracted from fx.ts)
   */
  private createServerRoutes(): FXServerRoutes {
    return {
      health: (c: Context) => {
        return c.json({ ok: true, time: new Date().toISOString() });
      },

      proxy: async (c: Context) => {
        const target = c.req.query('url');
        if (!target) {
          return c.json({ error: "Missing url parameter" }, 400);
        }

        try {
          const body = await this.extractRequestBody(c);
          const headers = new Headers(c.req.raw.headers);

          // Clean headers for cross-origin request
          headers.delete("host");
          headers.delete("origin");
          headers.delete("referer");
          headers.delete("cookie"); // Security: don't forward cookies

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

        } catch (error: any) {
          console.error('FX Proxy error:', error);
          return c.json({ error: String(error?.message || error) }, 500);
        }
      },

      module: async (c: Context) => {
        const target = c.req.query('url');
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

        } catch (error: any) {
          console.error('FX Module error:', error);
          return c.json({ error: String(error?.message || error) }, 500);
        }
      },

      info: (c: Context) => {
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
  private async corsMiddleware(c: Context, next: Next) {
    // Handle preflight
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: this.getCORSHeaders(c)
      });
    }

    await next();

    // Add CORS headers to response
    const corsHeaders = this.getCORSHeaders(c);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      c.res.headers.set(key, value);
    });
  }

  /**
   * Get CORS headers based on configuration
   */
  private getCORSHeaders(c: Context): Record<string, string> {
    const origin = c.req.header('origin') || '*';
    const allowedOrigin = this.options.allowedOrigins.includes('*') ||
                          this.options.allowedOrigins.includes(origin) ? origin : 'null';

    return {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
      'Access-Control-Allow-Credentials': 'false', // Security: no credentials
      'Access-Control-Max-Age': '86400' // 24 hours
    };
  }

  /**
   * Extract request body for proxy forwarding
   */
  private async extractRequestBody(c: Context): Promise<{ raw: string | Uint8Array } | null> {
    const contentType = c.req.header('content-type') || '';

    try {
      if (contentType.includes('application/json')) {
        const json = await c.req.json().catch(() => ({}));
        return { raw: JSON.stringify(json) };
      }

      if (contentType.includes('text/')) {
        const text = await c.req.text();
        return { raw: text };
      }

      if (contentType.includes('form')) {
        const formData = await c.req.formData();
        const params = new URLSearchParams();
        formData.forEach((value, key) => {
          params.append(key, value.toString());
        });
        return { raw: params.toString() };
      }

      // Binary data
      const arrayBuffer = await c.req.arrayBuffer();
      return { raw: new Uint8Array(arrayBuffer) };

    } catch (error) {
      console.warn('Failed to extract request body:', error);
      return null;
    }
  }

  /**
   * Create middleware for FX-Flow cross-realm execution
   */
  public createFlowMiddleware() {
    return async (c: Context, next: Next) => {
      // Add FX context to Hono context for flow execution
      c.set('fx', this.fx);
      c.set('fxHono', this);

      await next();
    };
  }

  /**
   * Add custom FX routes to Hono
   */
  public addCustomRoutes(app: Hono, routes: Record<string, (c: Context, fx: FX) => any>) {
    Object.entries(routes).forEach(([path, handler]) => {
      app.all(`${this.options.basePath}${path}`, async (c) => {
        try {
          const result = await handler(c, this.fx);
          return typeof result === 'object' && result.constructor === Response
            ? result
            : c.json(result);
        } catch (error: any) {
          console.error(`FX custom route error (${path}):`, error);
          return c.json({ error: error.message }, 500);
        }
      });
    });
  }
}

/**
 * Plugin factory function
 */
export default function fxHonoPlugin(fx: FX, options: FXHonoOptions = {}): FXHonoPlugin {
  return new FXHonoPlugin(fx, options);
}

/**
 * Convenience function to quickly set up FX in Hono
 */
export function setupFXWithHono(app: Hono, fx: FX, options: FXHonoOptions = {}): FXHonoPlugin {
  const fxHono = new FXHonoPlugin(fx, options);

  // Mount FX routes
  fxHono.mount(app);

  // Add FX flow middleware
  app.use('*', fxHono.createFlowMiddleware());

  return fxHono;
}

// Export types for external use
export type { FXHonoOptions, FXServerRoutes };