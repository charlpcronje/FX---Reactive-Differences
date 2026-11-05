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
  FXServiceWorkerManager: () => FXServiceWorkerManager,
  getFXServiceWorker: () => getFXServiceWorker,
  isCrossOriginIsolated: () => isCrossOriginIsolated,
  isServiceWorkerContext: () => isServiceWorkerContext,
  isServiceWorkerSupported: () => isServiceWorkerSupported,
  registerFXServiceWorker: () => registerFXServiceWorker
});
module.exports = __toCommonJS(stdin_exports);
class FXServiceWorkerManager {
  constructor(options = {}) {
    this.options = options;
    this.init();
  }
  registration = null;
  updateInterval = null;
  messageHandlers = /* @__PURE__ */ new Map();
  /**
   * Initialize Service Worker registration
   */
  async init() {
    if (!("serviceWorker" in navigator)) {
      console.warn("[FX-SW] Service Workers not supported in this browser");
      return;
    }
    try {
      if (!self.crossOriginIsolated) {
        console.warn("[FX-SW] Cross-Origin Isolation not enabled. Some features may not work.");
        console.info("[FX-SW] Add these headers to enable full functionality:");
        console.info("  Cross-Origin-Embedder-Policy: require-corp");
        console.info("  Cross-Origin-Opener-Policy: same-origin");
      }
      this.registration = await navigator.serviceWorker.register(
        "/fx-service-worker.js",
        {
          scope: this.options.scope || "/",
          updateViaCache: this.options.updateViaCache || "none"
        }
      );
      console.log("[FX-SW] Service Worker registered successfully");
      this.setupEventListeners();
      if (this.options.autoUpdate) {
        this.startAutoUpdate();
      }
      await this.checkForUpdate();
    } catch (error) {
      console.error("[FX-SW] Service Worker registration failed:", error);
    }
  }
  /**
   * Set up Service Worker event listeners
   */
  setupEventListeners() {
    if (!this.registration) return;
    this.registration.addEventListener("updatefound", () => {
      console.log("[FX-SW] Update found");
      this.options.onUpdateFound?.();
      const newWorker = this.registration.installing;
      if (newWorker) {
        newWorker.addEventListener("statechange", () => {
          console.log("[FX-SW] Worker state changed:", newWorker.state);
          this.options.onStateChange?.(newWorker.state);
          if (newWorker.state === "activated") {
            console.log("[FX-SW] New Service Worker activated");
            this.notifyUpdate();
          }
        });
      }
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      const { type, data } = event.data;
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.forEach((handler) => handler(data));
      }
    });
  }
  /**
   * Check for Service Worker updates
   */
  async checkForUpdate() {
    if (!this.registration) return;
    try {
      await this.registration.update();
    } catch (error) {
      console.error("[FX-SW] Update check failed:", error);
    }
  }
  /**
   * Start automatic update checking
   */
  startAutoUpdate() {
    const interval = this.options.autoUpdateInterval || 6e4;
    this.updateInterval = window.setInterval(() => {
      this.checkForUpdate();
    }, interval);
  }
  /**
   * Stop automatic update checking
   */
  stopAutoUpdate() {
    if (this.updateInterval !== null) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
  /**
   * Send message to Service Worker
   */
  async sendMessage(message) {
    if (!this.registration || !this.registration.active) {
      console.warn("[FX-SW] No active Service Worker");
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
      this.registration.active.postMessage(message, [messageChannel.port2]);
    });
  }
  /**
   * Register a message handler
   */
  onMessage(type, handler) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, /* @__PURE__ */ new Set());
    }
    this.messageHandlers.get(type).add(handler);
    return () => {
      this.messageHandlers.get(type)?.delete(handler);
    };
  }
  /**
   * Clear cache
   */
  async clearCache(cacheName) {
    await this.sendMessage({
      type: "CLEAR_CACHE",
      data: { cacheName }
    });
  }
  /**
   * Cache modules
   */
  async cacheModules(modules) {
    await this.sendMessage({
      type: "CACHE_MODULES",
      data: { modules }
    });
  }
  /**
   * Get cache status
   */
  async getCacheStatus() {
    return new Promise((resolve) => {
      const unsubscribe = this.onMessage("CACHE_STATUS", (data) => {
        unsubscribe();
        resolve(data);
      });
      this.sendMessage({ type: "GET_CACHE_STATUS" });
    });
  }
  /**
   * Notify about update
   */
  notifyUpdate() {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("FX Service Worker Updated", {
        body: "The FX Service Worker has been updated. Reload for the latest version.",
        icon: "/fx-icon.png"
      });
    }
  }
  /**
   * Unregister Service Worker
   */
  async unregister() {
    if (!this.registration) return false;
    this.stopAutoUpdate();
    return await this.registration.unregister();
  }
  /**
   * Get registration status
   */
  getRegistration() {
    return this.registration;
  }
  /**
   * Check if Service Worker is active
   */
  isActive() {
    return !!this.registration?.active;
  }
}
let defaultManager = null;
function registerFXServiceWorker(options) {
  if (!defaultManager) {
    defaultManager = new FXServiceWorkerManager(options);
  }
  return defaultManager;
}
function getFXServiceWorker() {
  return defaultManager;
}
function isServiceWorkerContext() {
  return typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope;
}
function isServiceWorkerSupported() {
  return "serviceWorker" in navigator;
}
function isCrossOriginIsolated() {
  return self.crossOriginIsolated === true;
}
if (typeof window !== "undefined" && isServiceWorkerSupported()) {
  if (!window.__FX_NO_AUTO_SW__) {
    window.addEventListener("load", () => {
      registerFXServiceWorker({
        autoUpdate: true,
        autoUpdateInterval: 6e4
        // Check every minute
      });
    });
  }
}
