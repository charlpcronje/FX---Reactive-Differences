/**
 * FX Service Worker Registration
 * Handles registration and communication with the FX Service Worker
 *
 * @version 1.0.0
 */

import type { ServiceWorkerMessage } from '../workers/fx-service-worker';

export interface FXServiceWorkerOptions {
  scope?: string;
  updateViaCache?: 'all' | 'imports' | 'none';
  onUpdateFound?: () => void;
  onStateChange?: (state: ServiceWorkerState) => void;
  autoUpdate?: boolean;
  autoUpdateInterval?: number;
}

export class FXServiceWorkerManager {
  private registration: ServiceWorkerRegistration | null = null;
  private updateInterval: number | null = null;
  private messageHandlers = new Map<string, Set<Function>>();

  constructor(private options: FXServiceWorkerOptions = {}) {
    this.init();
  }

  /**
   * Initialize Service Worker registration
   */
  private async init(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      console.warn('[FX-SW] Service Workers not supported in this browser');
      return;
    }

    try {
      // Check for required Cross-Origin-Isolation headers
      if (!self.crossOriginIsolated) {
        console.warn('[FX-SW] Cross-Origin Isolation not enabled. Some features may not work.');
        console.info('[FX-SW] Add these headers to enable full functionality:');
        console.info('  Cross-Origin-Embedder-Policy: require-corp');
        console.info('  Cross-Origin-Opener-Policy: same-origin');
      }

      // Register Service Worker
      this.registration = await navigator.serviceWorker.register(
        '/fx-service-worker.js',
        {
          scope: this.options.scope || '/',
          updateViaCache: this.options.updateViaCache || 'none',
        }
      );

      console.log('[FX-SW] Service Worker registered successfully');

      // Set up event listeners
      this.setupEventListeners();

      // Set up auto-update if enabled
      if (this.options.autoUpdate) {
        this.startAutoUpdate();
      }

      // Check for updates immediately
      await this.checkForUpdate();

    } catch (error) {
      console.error('[FX-SW] Service Worker registration failed:', error);
    }
  }

  /**
   * Set up Service Worker event listeners
   */
  private setupEventListeners(): void {
    if (!this.registration) return;

    // Listen for update found
    this.registration.addEventListener('updatefound', () => {
      console.log('[FX-SW] Update found');
      this.options.onUpdateFound?.();

      const newWorker = this.registration!.installing;
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          console.log('[FX-SW] Worker state changed:', newWorker.state);
          this.options.onStateChange?.(newWorker.state);

          if (newWorker.state === 'activated') {
            console.log('[FX-SW] New Service Worker activated');
            this.notifyUpdate();
          }
        });
      }
    });

    // Listen for messages from Service Worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      const { type, data } = event.data;
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.forEach(handler => handler(data));
      }
    });
  }

  /**
   * Check for Service Worker updates
   */
  async checkForUpdate(): Promise<void> {
    if (!this.registration) return;

    try {
      await this.registration.update();
    } catch (error) {
      console.error('[FX-SW] Update check failed:', error);
    }
  }

  /**
   * Start automatic update checking
   */
  private startAutoUpdate(): void {
    const interval = this.options.autoUpdateInterval || 60000; // Default: 1 minute

    this.updateInterval = window.setInterval(() => {
      this.checkForUpdate();
    }, interval);
  }

  /**
   * Stop automatic update checking
   */
  stopAutoUpdate(): void {
    if (this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Send message to Service Worker
   */
  async sendMessage(message: ServiceWorkerMessage): Promise<void> {
    if (!this.registration || !this.registration.active) {
      console.warn('[FX-SW] No active Service Worker');
      return;
    }

    const messageChannel = new MessageChannel();

    return new Promise((resolve, reject) => {
      messageChannel.port1.onmessage = (event) => {
        if (event.data.error) {
          reject(new Error(event.data.error));
        } else {
          resolve(event.data);
        }
      };

      this.registration!.active!.postMessage(message, [messageChannel.port2]);
    });
  }

  /**
   * Register a message handler
   */
  onMessage(type: string, handler: Function): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.messageHandlers.get(type)?.delete(handler);
    };
  }

  /**
   * Clear cache
   */
  async clearCache(cacheName?: string): Promise<void> {
    await this.sendMessage({
      type: 'CLEAR_CACHE',
      data: { cacheName },
    });
  }

  /**
   * Cache modules
   */
  async cacheModules(modules: string[]): Promise<void> {
    await this.sendMessage({
      type: 'CACHE_MODULES',
      data: { modules },
    });
  }

  /**
   * Get cache status
   */
  async getCacheStatus(): Promise<Record<string, number>> {
    return new Promise((resolve) => {
      const unsubscribe = this.onMessage('CACHE_STATUS', (data: Record<string, number>) => {
        unsubscribe();
        resolve(data);
      });

      this.sendMessage({ type: 'GET_CACHE_STATUS' });
    });
  }

  /**
   * Notify about update
   */
  private notifyUpdate(): void {
    // You can customize this notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('FX Service Worker Updated', {
        body: 'The FX Service Worker has been updated. Reload for the latest version.',
        icon: '/fx-icon.png',
      });
    }
  }

  /**
   * Unregister Service Worker
   */
  async unregister(): Promise<boolean> {
    if (!this.registration) return false;

    this.stopAutoUpdate();
    return await this.registration.unregister();
  }

  /**
   * Get registration status
   */
  getRegistration(): ServiceWorkerRegistration | null {
    return this.registration;
  }

  /**
   * Check if Service Worker is active
   */
  isActive(): boolean {
    return !!(this.registration?.active);
  }
}

/**
 * Default instance
 */
let defaultManager: FXServiceWorkerManager | null = null;

/**
 * Register FX Service Worker with default settings
 */
export function registerFXServiceWorker(options?: FXServiceWorkerOptions): FXServiceWorkerManager {
  if (!defaultManager) {
    defaultManager = new FXServiceWorkerManager(options);
  }
  return defaultManager;
}

/**
 * Get the default Service Worker manager
 */
export function getFXServiceWorker(): FXServiceWorkerManager | null {
  return defaultManager;
}

/**
 * Utility to check if running in Service Worker context
 */
export function isServiceWorkerContext(): boolean {
  return typeof ServiceWorkerGlobalScope !== 'undefined' &&
         self instanceof ServiceWorkerGlobalScope;
}

/**
 * Utility to check if Service Workers are supported
 */
export function isServiceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator;
}

/**
 * Utility to check Cross-Origin Isolation status
 */
export function isCrossOriginIsolated(): boolean {
  return self.crossOriginIsolated === true;
}

// Auto-register on import if in browser context
if (typeof window !== 'undefined' && isServiceWorkerSupported()) {
  // Allow opt-out via global flag
  if (!(window as any).__FX_NO_AUTO_SW__) {
    // Register with default options
    window.addEventListener('load', () => {
      registerFXServiceWorker({
        autoUpdate: true,
        autoUpdateInterval: 60000, // Check every minute
      });
    });
  }
}