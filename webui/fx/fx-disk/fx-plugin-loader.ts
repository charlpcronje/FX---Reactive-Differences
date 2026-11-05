// fx-disk/fx-plugin-loader.ts
/**
 * FX Plugin Loader - Enhanced @ syntax with VFS support
 *
 * Enables the syntax:
 *   $$("path.to.node@./plugins/fx-dom-dollar.ts").options({ global: "$dom" });
 *
 * Features:
 * - Loads modules from VFS (instant) or network (suspend/replay)
 * - Mounts module at specified FX path
 * - Supports global registration ($dom, $db, etc.)
 * - Works with FXDiskSyncLoader for zero-latency plugin loading
 */

import type { FXCore, FXNode, FXNodeProxy } from '../fx';

export interface PluginLoadOptions {
    /** Register as global variable (e.g., "$dom") */
    global?: string;

    /** Plugin type identifier */
    type?: string;

    /** Execute default export immediately */
    instantiateDefault?: boolean;

    /** Pass FX instance to plugin factory */
    passF?: boolean;

    /** Mount plugin at specific FX path (overrides path in selector) */
    mountPath?: string;

    /** Plugin configuration object */
    config?: Record<string, any>;

    /** Custom initialization callback */
    onInit?: (instance: any, node: FXNodeProxy) => void;
}

export interface PluginModuleSpec {
    /** FX path where to mount (e.g., "plugins.dom") */
    mountPath: string;

    /** Module path/URL (e.g., "./plugins/fx-dom-dollar.ts") */
    modulePath: string;
}

/**
 * Parse the enhanced @ syntax
 *
 * Examples:
 *   "plugins.dom@./plugins/fx-dom-dollar.ts"
 *   "@./plugins/fx-dom-dollar.ts" (mount at root)
 *   "app.utils@./lib/utils.js"
 */
export function parsePluginSpec(pathSpec: string): PluginModuleSpec | null {
    const atIndex = pathSpec.indexOf('@');

    if (atIndex === -1) {
        return null; // Not a plugin spec
    }

    const beforeAt = pathSpec.substring(0, atIndex);
    const afterAt = pathSpec.substring(atIndex + 1);

    // Leading @ means mount at root with auto path
    if (atIndex === 0) {
        // Extract module name from path
        const modulePath = afterAt;
        const fileName = modulePath.split('/').pop()?.replace(/\.(ts|js|mjs)$/, '') || 'plugin';
        const mountPath = `plugins.${fileName}`;

        return {
            mountPath,
            modulePath
        };
    }

    return {
        mountPath: beforeAt,
        modulePath: afterAt
    };
}

/**
 * Plugin Loader class
 */
export class PluginLoader {
    private fx: FXCore;
    private moduleLoader: any; // SyncModuleLoader or FXDiskSyncLoader
    private loadedPlugins = new Map<string, { instance: any; node: FXNode }>();

    constructor(fx: FXCore) {
        this.fx = fx;
        this.moduleLoader = (fx as any).moduleLoader;
    }

    /**
     * Load a plugin and mount it
     */
    loadPlugin(spec: PluginModuleSpec, options: PluginLoadOptions = {}): FXNodeProxy {
        const cacheKey = `${spec.mountPath}@${spec.modulePath}`;

        // Check if already loaded
        if (this.loadedPlugins.has(cacheKey) && !options.config) {
            const cached = this.loadedPlugins.get(cacheKey)!;
            return (this.fx as any).createNodeProxy(cached.node);
        }

        // Load the module code
        const moduleCode = this.moduleLoader.loadSync(spec.modulePath);

        // Execute the module
        const module = this.executeModule(moduleCode, spec.modulePath, options);

        // Get the mount path (from options or spec)
        const mountPath = options.mountPath || spec.mountPath;

        // Mount the plugin
        const node = this.mountPlugin(mountPath, module, options);

        // Cache it
        this.loadedPlugins.set(cacheKey, { instance: module, node });

        return (this.fx as any).createNodeProxy(node);
    }

    /**
     * Execute module code and return the export
     */
    private executeModule(code: string, modulePath: string, options: PluginLoadOptions): any {
        // Handle CSP-blocked modules
        if (code.includes('__fx_csp_blocked')) {
            console.warn(`[FX] Cannot load ${modulePath} in CSP mode`);
            return { __fx_csp_blocked: true };
        }

        // Transform export syntax
        const transformed = code
            .replace(/export\s+default\s+/g, 'module.exports.default = ')
            .replace(/\bexport\s+(const|let|var|function|class)\s+/g, '$1 ')
            .replace(/\bexport\s+\{[^}]+\}/g, '');

        const module: { exports: Record<string, any> } = { exports: {} };
        const exports = module.exports;

        try {
            // Create execution context
            const require = (depPath: string) => {
                const resolved = this.resolvePath(depPath, modulePath);
                const depCode = this.moduleLoader.loadSync(resolved);
                return this.executeModule(depCode, resolved, {});
            };

            // Create function with access to FX
            const fn = new Function('module', 'exports', 'require', 'fx', transformed);

            // Execute
            const fx = options.passF !== false ? this.fx : undefined;
            fn.call(exports, module, exports, require, fx);

            // Get the export
            let result = module.exports.default ?? module.exports;

            // If it's a factory function and instantiateDefault is true, call it
            if (options.instantiateDefault !== false && typeof result === 'function') {
                result = result(this.fx);
            }

            return result;

        } catch (error: any) {
            if (error.message?.includes('unsafe-eval')) {
                console.warn(`[FX] CSP blocks execution for ${modulePath}`);
                return { __fx_csp_blocked: true, __fx_module_url: modulePath };
            }
            throw error;
        }
    }

    /**
     * Mount plugin at FX path
     */
    private mountPlugin(path: string, instance: any, options: PluginLoadOptions): FXNode {
        // Set the plugin instance at the path
        const node = (this.fx as any).setPath(path, instance, this.fx.root);
        const proxy = (this.fx as any).createNodeProxy(node);

        // Set type
        if (options.type) {
            node.__type = options.type;
        }

        // Apply configuration
        if (options.config) {
            const configNode = (this.fx as any).setPath(`${path}.config`, options.config, this.fx.root);
        }

        // Register globally
        if (options.global) {
            (globalThis as any)[options.global] = proxy;
        }

        // Call initialization callback
        if (options.onInit) {
            try {
                options.onInit(instance, proxy);
            } catch (error) {
                console.error(`[FX] Plugin init callback failed for ${path}:`, error);
            }
        }

        return node;
    }

    /**
     * Resolve relative module paths
     */
    private resolvePath(importPath: string, fromPath: string): string {
        if (!importPath.startsWith('./') && !importPath.startsWith('../')) {
            return importPath;
        }

        const base = fromPath.substring(0, fromPath.lastIndexOf('/'));
        const parts = `${base}/${importPath}`.split('/');
        const result: string[] = [];

        for (const part of parts) {
            if (part === '' || part === '.') continue;
            if (part === '..') result.pop();
            else result.push(part);
        }

        return result.join('/');
    }

    /**
     * Check if a plugin is loaded
     */
    isLoaded(mountPath: string, modulePath?: string): boolean {
        if (modulePath) {
            const cacheKey = `${mountPath}@${modulePath}`;
            return this.loadedPlugins.has(cacheKey);
        }

        // Check by mount path only
        for (const [key] of this.loadedPlugins) {
            if (key.startsWith(`${mountPath}@`)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Unload a plugin
     */
    unload(mountPath: string, modulePath?: string): boolean {
        if (modulePath) {
            const cacheKey = `${mountPath}@${modulePath}`;
            return this.loadedPlugins.delete(cacheKey);
        }

        // Unload by mount path
        const toDelete: string[] = [];
        for (const [key] of this.loadedPlugins) {
            if (key.startsWith(`${mountPath}@`)) {
                toDelete.push(key);
            }
        }

        for (const key of toDelete) {
            this.loadedPlugins.delete(key);
        }

        return toDelete.length > 0;
    }

    /**
     * Get plugin stats
     */
    getStats() {
        return {
            loadedCount: this.loadedPlugins.size,
            plugins: Array.from(this.loadedPlugins.keys())
        };
    }
}

/**
 * Patch FXCore to support the enhanced @ syntax
 */
export function patchFXWithPluginLoader(fx: FXCore): PluginLoader {
    const loader = new PluginLoader(fx);

    // Store loader on FX instance
    (fx as any).__pluginLoader = loader;

    // Intercept proxy creation to handle @ syntax
    const originalProxy = fx.proxy.bind(fx);

    fx.proxy = function(path?: string) {
        // If no path, return root proxy
        if (!path) {
            return originalProxy();
        }

        // Check for @ syntax
        const spec = parsePluginSpec(path);

        if (!spec) {
            // Normal path, use original proxy
            return originalProxy(path);
        }

        // It's a plugin spec - return a special proxy with .options() method
        const pluginProxy = {
            options(opts: PluginLoadOptions = {}) {
                return loader.loadPlugin(spec, opts);
            }
        };

        return pluginProxy as any;
    };

    return loader;
}

/**
 * Global helper to load plugins
 */
export function $plugin(pathSpec: string, options?: PluginLoadOptions): FXNodeProxy | undefined {
    const fx = (globalThis as any).fx;
    if (!fx) {
        throw new Error('[FX] Global fx instance not found');
    }

    const loader = (fx as any).__pluginLoader as PluginLoader;
    if (!loader) {
        throw new Error('[FX] PluginLoader not initialized. Call patchFXWithPluginLoader(fx) first.');
    }

    const spec = parsePluginSpec(pathSpec);
    if (!spec) {
        throw new Error(`[FX] Invalid plugin spec: ${pathSpec}`);
    }

    return loader.loadPlugin(spec, options);
}

// Export types and utilities
export default {
    PluginLoader,
    parsePluginSpec,
    patchFXWithPluginLoader,
    $plugin
};
