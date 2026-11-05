// /plugins/fx-server.ts
/**
 * @fx-plugin fx-server
 * @version 1.0.0 "The Web"
 * @description FX Server - Complete HTTP server framework with FX nodes
 *
 * A Hono-inspired but FX-native HTTP server implementation.
 * Every request, response, route, and middleware is a reactive FX node.
 *
 * Architecture by: FX Team
 */

import type { FXCore, FXNodeProxy } from '../fx';

// ===== TYPES =====
export interface ServerConfig {
    port: number;
    host?: string;
    cors?: boolean | CorsOptions;
    compress?: boolean;
    maxBodySize?: number;
    timeout?: number;
    staticDir?: string;
    staticPrefix?: string;
}

export interface CorsOptions {
    origin?: string | string[] | ((origin: string) => boolean);
    methods?: string[];
    headers?: string[];
    credentials?: boolean;
    maxAge?: number;
}

export interface FXContext {
    request: FXRequest;
    response: FXResponse;
    params: FXNodeProxy;
    query: FXNodeProxy;
    state: FXNodeProxy;
    next: () => Promise<void>;
}

export interface FXRequest {
    method: FXNodeProxy<string>;
    url: FXNodeProxy<string>;
    path: FXNodeProxy<string>;
    headers: FXNodeProxy;
    body: FXNodeProxy;
    query: FXNodeProxy;
    params: FXNodeProxy;
    cookies: FXNodeProxy;
    ip: FXNodeProxy<string>;
}

export interface FXResponse {
    status: (code: number) => FXResponse;
    headers: FXNodeProxy;
    body: FXNodeProxy;
    json: (data: any) => FXResponse;
    text: (text: string) => FXResponse;
    html: (html: string) => FXResponse;
    redirect: (url: string, code?: number) => FXResponse;
    cookie: (name: string, value: string, options?: any) => FXResponse;
    send: () => void;
}

export type Middleware = (ctx: FXContext) => Promise<void> | void;
export type Handler = (ctx: FXContext) => Promise<void> | void;

export interface Route {
    method: string | string[];
    path: string;
    handlers: Handler[];
    params?: string[];
}

// ===== MAIN CLASS =====
export class FXServer {
    private fx: FXCore;
    private config: ServerConfig;
    private routes: Route[] = [];
    private middleware: Middleware[] = [];
    private server: any;
    private wsHandlers = new Map<string, (ws: any) => void>();

    // FX nodes
    private $server: FXNodeProxy;
    private $routes: FXNodeProxy;
    private $middleware: FXNodeProxy;
    private $stats: FXNodeProxy;

    constructor(fx: FXCore, config: ServerConfig) {
        this.fx = fx;
        this.config = config;

        // Initialize FX nodes
        this.$server = fx.proxy('server');
        this.$routes = fx.proxy('server.routes');
        this.$middleware = fx.proxy('server.middleware');
        this.$stats = fx.proxy('server.stats');

        // Initialize stats
        this.$stats.val({
            requests: 0,
            errors: 0,
            avgResponseTime: 0,
            activeConnections: 0
        });

        // Setup default middleware
        this.setupDefaultMiddleware();
    }

    /**
     * Setup default middleware
     */
    private setupDefaultMiddleware() {
        // Request logging
        if (this.config.cors) {
            this.use(this.corsMiddleware());
        }

        // Body parsing
        this.use(this.bodyParserMiddleware());

        // Query parsing
        this.use(this.queryParserMiddleware());
    }

    /**
     * CORS middleware
     */
    private corsMiddleware(): Middleware {
        return async (ctx: FXContext) => {
            const corsConfig = typeof this.config.cors === 'object'
                ? this.config.cors
                : {} as CorsOptions;

            const origin = ctx.request.headers.get('origin').val() || '*';
            const allowedOrigin = corsConfig.origin || '*';

            // Set CORS headers
            ctx.response.headers.set('Access-Control-Allow-Origin',
                typeof allowedOrigin === 'function'
                    ? allowedOrigin(origin) ? origin : ''
                    : allowedOrigin
            );

            if (corsConfig.credentials) {
                ctx.response.headers.set('Access-Control-Allow-Credentials', 'true');
            }

            if (ctx.request.method.val() === 'OPTIONS') {
                ctx.response.headers.set('Access-Control-Allow-Methods',
                    (corsConfig.methods || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']).join(', ')
                );
                ctx.response.headers.set('Access-Control-Allow-Headers',
                    (corsConfig.headers || ['Content-Type', 'Authorization']).join(', ')
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
    private bodyParserMiddleware(): Middleware {
        return async (ctx: FXContext) => {
            const contentType = ctx.request.headers.get('content-type').val() || '';

            if (contentType.includes('application/json')) {
                try {
                    const rawBody = await this.readBody(ctx.request);
                    ctx.request.body.val(JSON.parse(rawBody));
                } catch (error) {
                    ctx.request.body.val({});
                }
            } else if (contentType.includes('application/x-www-form-urlencoded')) {
                const rawBody = await this.readBody(ctx.request);
                const parsed = new URLSearchParams(rawBody);
                const body: any = {};
                for (const [key, value] of parsed) {
                    body[key] = value;
                }
                ctx.request.body.val(body);
            } else if (contentType.includes('multipart/form-data')) {
                // Basic multipart parsing (simplified)
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
    private queryParserMiddleware(): Middleware {
        return async (ctx: FXContext) => {
            const url = new URL(ctx.request.url.val(), `http://${this.config.host || 'localhost'}`);
            const query: any = {};

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
    private async readBody(request: FXRequest): Promise<string> {
        // This would be implemented based on the runtime (Node.js vs Deno)
        // For now, return empty string
        return '';
    }

    /**
     * Add middleware
     */
    use(middleware: Middleware) {
        this.middleware.push(middleware);

        // Update FX node
        this.$middleware.set(this.middleware.length - 1, {
            fn: middleware.toString(),
            added: new Date().toISOString()
        });

        return this;
    }

    /**
     * Add route
     */
    route(path: string, method: string | string[], ...handlers: Handler[]) {
        const methods = Array.isArray(method) ? method : [method];

        // Extract path parameters
        const params: string[] = [];
        const regexPath = path.replace(/:([^/]+)/g, (_, param) => {
            params.push(param);
            return '([^/]+)';
        });

        const route: Route = {
            method: methods,
            path,
            handlers,
            params
        };

        this.routes.push(route);

        // Update FX node
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
    get(path: string, ...handlers: Handler[]) {
        return this.route(path, 'GET', ...handlers);
    }

    post(path: string, ...handlers: Handler[]) {
        return this.route(path, 'POST', ...handlers);
    }

    put(path: string, ...handlers: Handler[]) {
        return this.route(path, 'PUT', ...handlers);
    }

    delete(path: string, ...handlers: Handler[]) {
        return this.route(path, 'DELETE', ...handlers);
    }

    patch(path: string, ...handlers: Handler[]) {
        return this.route(path, 'PATCH', ...handlers);
    }

    head(path: string, ...handlers: Handler[]) {
        return this.route(path, 'HEAD', ...handlers);
    }

    options(path: string, ...handlers: Handler[]) {
        return this.route(path, 'OPTIONS', ...handlers);
    }

    all(path: string, ...handlers: Handler[]) {
        return this.route(path, ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], ...handlers);
    }

    /**
     * WebSocket support
     */
    ws(path: string, handler: (ws: any) => void) {
        this.wsHandlers.set(path, handler);
        return this;
    }

    /**
     * Static file serving
     */
    static(prefix: string = '/static', dir: string = './public') {
        this.get(`${prefix}/*`, async (ctx: FXContext) => {
            const path = ctx.request.path.val().slice(prefix.length);
            // This would serve static files from the specified directory
            // Implementation depends on runtime (Node.js vs Deno)
            ctx.response.status(404).text('Not Found');
        });

        return this;
    }

    /**
     * Find matching route
     */
    private findRoute(method: string, path: string): { route: Route; params: Record<string, string> } | null {
        for (const route of this.routes) {
            if (!route.method.includes(method)) continue;

            // Check exact match
            if (route.path === path) {
                return { route, params: {} };
            }

            // Check pattern match
            if (route.params && route.params.length > 0) {
                const pattern = route.path.replace(/:([^/]+)/g, '([^/]+)');
                const regex = new RegExp(`^${pattern}$`);
                const match = path.match(regex);

                if (match) {
                    const params: Record<string, string> = {};
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
    private async handleRequest(req: any, res: any) {
        // Update stats
        const stats = this.$stats.val();
        stats.requests++;
        stats.activeConnections++;
        this.$stats.val(stats);

        const startTime = Date.now();

        // Create FX context
        const ctx = this.createContext(req, res);

        try {
            // Execute middleware chain
            let middlewareIndex = 0;

            const next = async () => {
                if (middlewareIndex < this.middleware.length) {
                    const mw = this.middleware[middlewareIndex++];
                    await mw(ctx);
                } else {
                    // Find and execute route handler
                    const routeMatch = this.findRoute(
                        ctx.request.method.val(),
                        ctx.request.path.val()
                    );

                    if (routeMatch) {
                        ctx.params.val(routeMatch.params);
                        ctx.request.params.val(routeMatch.params);

                        // Execute route handlers
                        for (const handler of routeMatch.route.handlers) {
                            await handler(ctx);
                        }
                    } else {
                        ctx.response.status(404).text('Not Found');
                    }
                }
            };

            ctx.next = next;
            await next();

            // Send response if not already sent
            if (!res.headersSent) {
                ctx.response.send();
            }

        } catch (error) {
            console.error('Server error:', error);
            stats.errors++;

            if (!res.headersSent) {
                ctx.response.status(500).json({
                    error: 'Internal Server Error',
                    message: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        } finally {
            // Update stats
            stats.activeConnections--;
            const responseTime = Date.now() - startTime;
            stats.avgResponseTime = (stats.avgResponseTime * (stats.requests - 1) + responseTime) / stats.requests;
            this.$stats.val(stats);
        }
    }

    /**
     * Create FX context for request
     */
    private createContext(req: any, res: any): FXContext {
        const url = new URL(req.url || '/', `http://${this.config.host || 'localhost'}`);

        // Create request node
        const request: FXRequest = {
            method: this.fx.proxy('server.request.method').val(req.method || 'GET'),
            url: this.fx.proxy('server.request.url').val(req.url || '/'),
            path: this.fx.proxy('server.request.path').val(url.pathname),
            headers: this.fx.proxy('server.request.headers').val(req.headers || {}),
            body: this.fx.proxy('server.request.body').val({}),
            query: this.fx.proxy('server.request.query').val({}),
            params: this.fx.proxy('server.request.params').val({}),
            cookies: this.fx.proxy('server.request.cookies').val({}),
            ip: this.fx.proxy('server.request.ip').val(req.socket?.remoteAddress || '')
        };

        // Create response node
        const responseHeaders = this.fx.proxy('server.response.headers').val({});
        const responseBody = this.fx.proxy('server.response.body').val('');
        const responseStatus = this.fx.proxy('server.response.status').val(200);

        const response: FXResponse = {
            status: (code: number) => {
                responseStatus.val(code);
                return response;
            },
            headers: responseHeaders,
            body: responseBody,
            json: (data: any) => {
                responseHeaders.set('Content-Type', 'application/json');
                responseBody.val(JSON.stringify(data));
                return response;
            },
            text: (text: string) => {
                responseHeaders.set('Content-Type', 'text/plain');
                responseBody.val(text);
                return response;
            },
            html: (html: string) => {
                responseHeaders.set('Content-Type', 'text/html');
                responseBody.val(html);
                return response;
            },
            redirect: (url: string, code = 302) => {
                responseStatus.val(code);
                responseHeaders.set('Location', url);
                return response;
            },
            cookie: (name: string, value: string, options: any = {}) => {
                const cookieStr = `${name}=${value}; ${Object.entries(options).map(([k, v]) => `${k}=${v}`).join('; ')}`;
                const existingCookies = responseHeaders.get('Set-Cookie').val();
                if (existingCookies) {
                    responseHeaders.set('Set-Cookie', Array.isArray(existingCookies)
                        ? [...existingCookies, cookieStr]
                        : [existingCookies, cookieStr]
                    );
                } else {
                    responseHeaders.set('Set-Cookie', cookieStr);
                }
                return response;
            },
            send: () => {
                res.statusCode = responseStatus.val();

                // Set headers
                const headers = responseHeaders.val();
                for (const [key, value] of Object.entries(headers)) {
                    res.setHeader(key, value as any);
                }

                // Send body
                res.end(responseBody.val());
            }
        };

        return {
            request,
            response,
            params: this.fx.proxy('server.context.params').val({}),
            query: this.fx.proxy('server.context.query').val({}),
            state: this.fx.proxy('server.context.state').val({}),
            next: async () => {}
        };
    }

    /**
     * Start the server
     */
    async listen(callback?: () => void) {
        const { port, host = 'localhost' } = this.config;

        // Implementation depends on runtime
        if (typeof (globalThis as any).Deno !== 'undefined') {
            // Deno implementation
            this.server = (Deno as any).serve({
                port,
                hostname: host,
                handler: async (req: Request) => {
                    const fakeRes = {
                        statusCode: 200,
                        headers: new Map(),
                        setHeader: (key: string, value: any) => {
                            this.headers.set(key, value);
                        },
                        end: (body: any) => {
                            return new Response(body, {
                                status: this.statusCode,
                                headers: Object.fromEntries(this.headers)
                            });
                        },
                        headersSent: false
                    };

                    await this.handleRequest(req, fakeRes);
                    return fakeRes as any;
                }
            });

        } else if (typeof process !== 'undefined') {
            // Node.js implementation
            const http = require('http');

            this.server = http.createServer((req: any, res: any) => {
                this.handleRequest(req, res);
            });

            this.server.listen(port, host, () => {
                console.log(`[FX Server] Listening on http://${host}:${port}`);
                if (callback) callback();
            });
        }

        // Update server node
        this.$server.set('status', 'running');
        this.$server.set('port', port);
        this.$server.set('host', host);

        return this;
    }

    /**
     * Stop the server
     */
    async stop() {
        if (this.server) {
            if (typeof (globalThis as any).Deno !== 'undefined') {
                // Deno doesn't have a direct stop method for servers yet
                this.server = null;
            } else if (typeof process !== 'undefined') {
                this.server.close();
            }
        }

        this.$server.set('status', 'stopped');
    }
}

// ===== FACTORY FUNCTION =====
export default function createFXServer(fx: FXCore) {
    // Create factory methods
    const serverFactory = {
        create: (config: ServerConfig) => new FXServer(fx, config),

        // Quick server creation
        quickStart: (port = 3000, handler?: Handler) => {
            const server = new FXServer(fx, { port });

            if (handler) {
                server.all('*', handler);
            }

            return server;
        },

        // Express-like API
        express: () => {
            const server = new FXServer(fx, { port: 3000, cors: true });

            // Add some Express-like convenience
            (server as any).locals = fx.proxy('server.locals').val({});

            return server;
        }
    };

    // Register with FX
    fx.pluginManager.register('server', serverFactory, { global: '$server' });

    return serverFactory;
}

// ===== HELPERS & UTILITIES =====

/**
 * Router for grouping routes
 */
export class Router {
    private routes: Route[] = [];
    private prefix: string;

    constructor(prefix = '') {
        this.prefix = prefix;
    }

    route(path: string, method: string | string[], ...handlers: Handler[]) {
        const fullPath = this.prefix + path;
        this.routes.push({
            method: Array.isArray(method) ? method : [method],
            path: fullPath,
            handlers,
            params: []
        });
        return this;
    }

    get(path: string, ...handlers: Handler[]) {
        return this.route(path, 'GET', ...handlers);
    }

    post(path: string, ...handlers: Handler[]) {
        return this.route(path, 'POST', ...handlers);
    }

    mount(server: FXServer) {
        for (const route of this.routes) {
            server.route(route.path, route.method, ...route.handlers);
        }
    }
}

/**
 * Response helpers
 */
export const responses = {
    ok: (data: any) => ({ status: 200, data }),
    created: (data: any) => ({ status: 201, data }),
    accepted: (data: any) => ({ status: 202, data }),
    noContent: () => ({ status: 204 }),
    badRequest: (message: string) => ({ status: 400, error: message }),
    unauthorized: (message = 'Unauthorized') => ({ status: 401, error: message }),
    forbidden: (message = 'Forbidden') => ({ status: 403, error: message }),
    notFound: (message = 'Not Found') => ({ status: 404, error: message }),
    serverError: (message = 'Internal Server Error') => ({ status: 500, error: message })
};