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
  FXCachePlugin: () => FXCachePlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class CacheLogger {
  static logBuffer = [];
  static log(level, message, data = {}) {
    const entry = { level: level.toUpperCase(), message, data, timestamp: Date.now() };
    this.logBuffer.push(entry);
    console.log(`[FX-CACHE:${entry.level}]`, message, data);
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
  static debug(message, data) {
    this.log("debug", message, data);
  }
}
class IndexedDBCache {
  dbName;
  version;
  db = null;
  isReady = false;
  readyPromise;
  stats = { hits: 0, misses: 0 };
  constructor(dbName = "fx-cache", version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.readyPromise = this.init();
  }
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      request.onerror = () => {
        CacheLogger.error("Failed to open IndexedDB", request.error);
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        this.isReady = true;
        CacheLogger.info("IndexedDB cache initialized");
        resolve();
      };
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains("cache")) {
          const cacheStore = db.createObjectStore("cache", { keyPath: "key" });
          cacheStore.createIndex("namespace", "namespace", { unique: false });
          cacheStore.createIndex("expiry", "expiry", { unique: false });
          cacheStore.createIndex("created", "created", { unique: false });
          cacheStore.createIndex("tags", "tags", { unique: false, multiEntry: true });
          cacheStore.createIndex("lastAccessed", "lastAccessed", { unique: false });
        }
        if (!db.objectStoreNames.contains("metadata")) {
          db.createObjectStore("metadata", { keyPath: "key" });
        }
      };
    });
  }
  async ensureReady() {
    if (!this.isReady) await this.readyPromise;
  }
  buildKey(namespace, key) {
    return `${namespace}:${key}`;
  }
  calculateSize(value) {
    try {
      return new Blob([JSON.stringify(value)]).size;
    } catch {
      return 0;
    }
  }
  async compress(value) {
    if (typeof value !== "string") {
      value = JSON.stringify(value);
    }
    if ("CompressionStream" in globalThis) {
      try {
        const blob = new Blob([value]);
        const stream = blob.stream().pipeThrough(new globalThis.CompressionStream("gzip"));
        const compressed = await new Response(stream).blob();
        return await compressed.arrayBuffer();
      } catch {
        return value;
      }
    }
    return value;
  }
  async decompress(value) {
    if (value instanceof ArrayBuffer && "DecompressionStream" in globalThis) {
      try {
        const blob = new Blob([value]);
        const stream = blob.stream().pipeThrough(new globalThis.DecompressionStream("gzip"));
        const decompressed = await new Response(stream).text();
        return JSON.parse(decompressed);
      } catch {
        return value;
      }
    }
    return value;
  }
  async set(key, value, options = {}) {
    await this.ensureReady();
    const {
      namespace = "default",
      ttl = 24 * 60 * 60 * 1e3,
      tags = [],
      compress = false
    } = options;
    const now = Date.now();
    const fullKey = this.buildKey(namespace, key);
    const processedValue = compress ? await this.compress(value) : value;
    const record = {
      key: fullKey,
      namespace,
      value: processedValue,
      created: now,
      expiry: ttl > 0 ? now + ttl : null,
      tags,
      size: this.calculateSize(processedValue),
      hits: 0,
      lastAccessed: now
    };
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      const request = store.put(record);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
  async get(key, namespace = "default") {
    await this.ensureReady();
    const fullKey = this.buildKey(namespace, key);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      const request = store.get(fullKey);
      request.onsuccess = async () => {
        const record = request.result;
        if (!record) {
          this.stats.misses++;
          resolve(null);
          return;
        }
        if (record.expiry && Date.now() > record.expiry) {
          this.delete(key, namespace);
          this.stats.misses++;
          resolve(null);
          return;
        }
        this.stats.hits++;
        record.hits = (record.hits || 0) + 1;
        record.lastAccessed = Date.now();
        store.put(record);
        const value = record.value instanceof ArrayBuffer ? await this.decompress(record.value) : record.value;
        resolve(value);
      };
      request.onerror = () => reject(request.error);
    });
  }
  async delete(key, namespace = "default") {
    await this.ensureReady();
    const fullKey = this.buildKey(namespace, key);
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      const request = store.delete(fullKey);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
  async clear(namespace) {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      if (namespace) {
        const index = store.index("namespace");
        const request = index.openCursor(IDBKeyRange.only(namespace));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve(true);
          }
        };
        request.onerror = () => reject(request.error);
      } else {
        const request = store.clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      }
    });
  }
  async getByTags(tags) {
    await this.ensureReady();
    const results = [];
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readonly");
      const store = transaction.objectStore("cache");
      const index = store.index("tags");
      const promises = tags.map((tag) => {
        return new Promise((res) => {
          const request = index.openCursor(IDBKeyRange.only(tag));
          const tagResults = [];
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const record = cursor.value;
              if (!record.expiry || Date.now() <= record.expiry) {
                tagResults.push(record.value);
              }
              cursor.continue();
            } else {
              res(tagResults);
            }
          };
        });
      });
      Promise.all(promises).then((allResults) => {
        resolve(allResults.flat());
      });
    });
  }
  async cleanExpired() {
    await this.ensureReady();
    const now = Date.now();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readwrite");
      const store = transaction.objectStore("cache");
      const index = store.index("expiry");
      const request = index.openCursor(IDBKeyRange.upperBound(now));
      let deletedCount = 0;
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor && cursor.value.expiry) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          CacheLogger.info(`Cleaned ${deletedCount} expired cache entries`);
          resolve(deletedCount);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
  async getStats() {
    await this.ensureReady();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["cache"], "readonly");
      const store = transaction.objectStore("cache");
      const request = store.getAll();
      request.onsuccess = () => {
        const records = request.result;
        const now = Date.now();
        const stats = {
          totalEntries: records.length,
          totalSize: records.reduce((sum, r) => sum + r.size, 0),
          expiredEntries: records.filter((r) => r.expiry && now > r.expiry).length,
          namespaces: [...new Set(records.map((r) => r.namespace))],
          oldestEntry: records.length > 0 ? Math.min(...records.map((r) => r.created)) : null,
          newestEntry: records.length > 0 ? Math.max(...records.map((r) => r.created)) : null,
          hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
          missRate: this.stats.misses / (this.stats.hits + this.stats.misses) || 0
        };
        resolve(stats);
      };
      request.onerror = () => reject(request.error);
    });
  }
}
class MemoryCache {
  cache = /* @__PURE__ */ new Map();
  accessOrder = /* @__PURE__ */ new Map();
  maxSize;
  maxMemory;
  currentMemory = 0;
  stats = { hits: 0, misses: 0 };
  constructor(maxSize = 1e3, maxMemory = 50 * 1024 * 1024) {
    this.maxSize = maxSize;
    this.maxMemory = maxMemory;
  }
  set(key, value, options = {}) {
    const {
      ttl = 5 * 60 * 1e3,
      // 5 minutes default
      namespace = "default",
      tags = []
    } = options;
    const fullKey = `${namespace}:${key}`;
    const now = Date.now();
    const size = this.calculateSize(value);
    if (this.currentMemory + size > this.maxMemory) {
      this.evictLRU(size);
    }
    const record = {
      key: fullKey,
      namespace,
      value,
      created: now,
      expiry: ttl > 0 ? now + ttl : null,
      tags,
      size,
      hits: 0,
      lastAccessed: now
    };
    const oldRecord = this.cache.get(fullKey);
    if (oldRecord) {
      this.currentMemory -= oldRecord.size;
    }
    this.currentMemory += size;
    this.accessOrder.set(fullKey, now);
    this.cache.set(fullKey, record);
    this.evictIfNeeded();
    return true;
  }
  get(key, namespace = "default") {
    const fullKey = `${namespace}:${key}`;
    const record = this.cache.get(fullKey);
    if (!record) {
      this.stats.misses++;
      return null;
    }
    if (record.expiry && Date.now() > record.expiry) {
      this.delete(key, namespace);
      this.stats.misses++;
      return null;
    }
    const now = Date.now();
    this.accessOrder.set(fullKey, now);
    record.hits = (record.hits ?? 0) + 1;
    record.lastAccessed = now;
    this.stats.hits++;
    return record.value;
  }
  delete(key, namespace = "default") {
    const fullKey = `${namespace}:${key}`;
    const record = this.cache.get(fullKey);
    if (record) {
      this.currentMemory -= record.size;
      this.cache.delete(fullKey);
      this.accessOrder.delete(fullKey);
      return true;
    }
    return false;
  }
  clear(namespace) {
    if (namespace) {
      const keysToDelete = [];
      for (const [key, record] of this.cache) {
        if (record.namespace === namespace) {
          keysToDelete.push(key);
          this.currentMemory -= record.size;
        }
      }
      keysToDelete.forEach((key) => {
        this.cache.delete(key);
        this.accessOrder.delete(key);
      });
    } else {
      this.cache.clear();
      this.accessOrder.clear();
      this.currentMemory = 0;
    }
    return true;
  }
  calculateSize(value) {
    try {
      return JSON.stringify(value).length * 2;
    } catch {
      return 100;
    }
  }
  evictIfNeeded() {
    if (this.cache.size <= this.maxSize) return;
    const toRemove = this.cache.size - this.maxSize + 1;
    this.evictLRU(0, toRemove);
  }
  evictLRU(requiredSpace, count) {
    const sortedByAccess = [...this.accessOrder.entries()].sort((a, b) => a[1] - b[1]);
    let freedSpace = 0;
    let removed = 0;
    for (const [key] of sortedByAccess) {
      if (count && removed >= count || !count && freedSpace >= requiredSpace) {
        break;
      }
      const record = this.cache.get(key);
      if (record) {
        freedSpace += record.size;
        this.currentMemory -= record.size;
        this.cache.delete(key);
        this.accessOrder.delete(key);
        removed++;
      }
    }
  }
  getStats() {
    const now = Date.now();
    const records = [...this.cache.values()];
    return {
      totalEntries: this.cache.size,
      totalSize: this.currentMemory,
      expiredEntries: records.filter((r) => r.expiry && now > r.expiry).length,
      namespaces: [...new Set(records.map((r) => r.namespace))],
      oldestEntry: records.length > 0 ? Math.min(...records.map((r) => r.created)) : null,
      newestEntry: records.length > 0 ? Math.max(...records.map((r) => r.created)) : null,
      hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
      missRate: this.stats.misses / (this.stats.hits + this.stats.misses) || 0
    };
  }
}
class ServiceWorkerCache {
  cacheName;
  isAvailable = false;
  constructor(cacheName = "fx-cache-v1") {
    this.cacheName = cacheName;
    this.isAvailable = "caches" in globalThis;
  }
  async set(key, value, options = {}) {
    if (!this.isAvailable) return false;
    try {
      const cache = await caches.open(this.cacheName);
      const response = new Response(JSON.stringify({
        value,
        metadata: {
          created: Date.now(),
          ttl: options.ttl,
          namespace: options.namespace
        }
      }));
      await cache.put(new Request(key), response);
      return true;
    } catch (error) {
      CacheLogger.error("Service Worker cache set failed", error);
      return false;
    }
  }
  async get(key) {
    if (!this.isAvailable) return null;
    try {
      const cache = await caches.open(this.cacheName);
      const response = await cache.match(new Request(key));
      if (!response) return null;
      const data = await response.json();
      const metadata = data.metadata;
      if (metadata.ttl && Date.now() > metadata.created + metadata.ttl) {
        await cache.delete(new Request(key));
        return null;
      }
      return data.value;
    } catch (error) {
      CacheLogger.error("Service Worker cache get failed", error);
      return null;
    }
  }
  async delete(key) {
    if (!this.isAvailable) return false;
    try {
      const cache = await caches.open(this.cacheName);
      return await cache.delete(new Request(key));
    } catch (error) {
      CacheLogger.error("Service Worker cache delete failed", error);
      return false;
    }
  }
  async clear() {
    if (!this.isAvailable) return false;
    try {
      return await caches.delete(this.cacheName);
    } catch (error) {
      CacheLogger.error("Service Worker cache clear failed", error);
      return false;
    }
  }
}
class FXCachePlugin {
  fx;
  options;
  name = "cache";
  version = "2.0.0";
  description = "Multi-tier caching with compression and service worker support";
  memoryCache;
  persistentCache;
  serviceWorkerCache;
  cleanupTimer;
  stats = {
    operations: { get: 0, set: 0, delete: 0 },
    hits: { memory: 0, persistent: 0, service: 0 },
    misses: { memory: 0, persistent: 0, service: 0 }
  };
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      memoryEnabled: true,
      persistentEnabled: true,
      serviceWorkerEnabled: true,
      maxMemorySize: 1e3,
      maxMemoryBytes: 50 * 1024 * 1024,
      // 50MB
      defaultTTL: 24 * 60 * 60 * 1e3,
      // 24 hours
      autoCleanup: true,
      cleanupInterval: 60 * 60 * 1e3,
      // 1 hour
      compressionThreshold: 1024,
      // Compress if > 1KB
      ...options
    };
    this.init();
  }
  async init() {
    try {
      if (this.options.memoryEnabled) {
        this.memoryCache = new MemoryCache(
          this.options.maxMemorySize,
          this.options.maxMemoryBytes
        );
        CacheLogger.info("Memory cache initialized");
      }
      if (this.options.persistentEnabled && typeof indexedDB !== "undefined") {
        this.persistentCache = new IndexedDBCache();
        await this.persistentCache["readyPromise"];
        CacheLogger.info("Persistent cache initialized");
      }
      if (this.options.serviceWorkerEnabled && "caches" in globalThis) {
        this.serviceWorkerCache = new ServiceWorkerCache();
        CacheLogger.info("Service Worker cache initialized");
      }
      if (this.options.autoCleanup) {
        this.setupAutoCleanup();
      }
      CacheLogger.info("FX Cache plugin initialized", {
        memory: !!this.memoryCache,
        persistent: !!this.persistentCache,
        serviceWorker: !!this.serviceWorkerCache
      });
    } catch (error) {
      CacheLogger.error("Failed to initialize cache plugin", error);
    }
  }
  setupAutoCleanup() {
    this.cleanupTimer = setInterval(async () => {
      try {
        if (this.persistentCache) {
          await this.persistentCache.cleanExpired();
        }
        if (this.memoryCache) {
          const stats = this.memoryCache.getStats();
          if (stats.expiredEntries > 0) {
            CacheLogger.info(`Cleaning ${stats.expiredEntries} expired memory entries`);
          }
        }
      } catch (error) {
        CacheLogger.error("Auto cleanup failed", error);
      }
    }, this.options.cleanupInterval);
  }
  async set(key, value, options = {}) {
    this.stats.operations.set++;
    const cacheOptions = {
      ttl: this.options.defaultTTL,
      namespace: "default",
      priority: "both",
      compress: this.calculateSize(value) > this.options.compressionThreshold,
      ...options
    };
    const promises = [];
    if (this.memoryCache && cacheOptions.priority !== "persistent") {
      try {
        this.memoryCache.set(key, value, cacheOptions);
      } catch (error) {
        CacheLogger.warn("Failed to set memory cache", error);
      }
    }
    if (this.persistentCache && cacheOptions.priority !== "memory") {
      promises.push(
        this.persistentCache.set(key, value, cacheOptions).catch((error) => {
          CacheLogger.warn("Failed to set persistent cache", error);
          return false;
        })
      );
    }
    if (this.serviceWorkerCache && cacheOptions.priority === "both") {
      promises.push(
        this.serviceWorkerCache.set(key, value, cacheOptions).catch((error) => {
          CacheLogger.warn("Failed to set service worker cache", error);
          return false;
        })
      );
    }
    const results = await Promise.all(promises);
    return results.some((r) => r === true);
  }
  async get(key, options = {}) {
    this.stats.operations.get++;
    const { namespace = "default", skipMemory = false, skipPersistent = false } = options;
    if (this.memoryCache && !skipMemory) {
      const memoryResult = this.memoryCache.get(key, namespace);
      if (memoryResult !== null) {
        this.stats.hits.memory++;
        CacheLogger.debug("Cache hit (memory)", { key, namespace });
        return memoryResult;
      }
      this.stats.misses.memory++;
    }
    if (this.persistentCache && !skipPersistent) {
      try {
        const persistentResult = await this.persistentCache.get(key, namespace);
        if (persistentResult !== null) {
          this.stats.hits.persistent++;
          CacheLogger.debug("Cache hit (persistent)", { key, namespace });
          if (this.memoryCache && !skipMemory) {
            this.memoryCache.set(key, persistentResult, { namespace });
          }
          return persistentResult;
        }
        this.stats.misses.persistent++;
      } catch (error) {
        CacheLogger.warn("Failed to get from persistent cache", error);
      }
    }
    if (this.serviceWorkerCache) {
      try {
        const swResult = await this.serviceWorkerCache.get(`${namespace}:${key}`);
        if (swResult !== null) {
          this.stats.hits.service++;
          CacheLogger.debug("Cache hit (service worker)", { key, namespace });
          return swResult;
        }
        this.stats.misses.service++;
      } catch (error) {
        CacheLogger.warn("Failed to get from service worker cache", error);
      }
    }
    CacheLogger.debug("Cache miss", { key, namespace });
    return null;
  }
  async delete(key, options = {}) {
    this.stats.operations.delete++;
    const { namespace = "default" } = options;
    const promises = [];
    if (this.memoryCache) {
      this.memoryCache.delete(key, namespace);
    }
    if (this.persistentCache) {
      promises.push(
        this.persistentCache.delete(key, namespace).catch((error) => {
          CacheLogger.warn("Failed to delete from persistent cache", error);
          return false;
        })
      );
    }
    if (this.serviceWorkerCache) {
      promises.push(
        this.serviceWorkerCache.delete(`${namespace}:${key}`).catch((error) => {
          CacheLogger.warn("Failed to delete from service worker cache", error);
          return false;
        })
      );
    }
    await Promise.all(promises);
    return true;
  }
  async clear(namespace) {
    const promises = [];
    if (this.memoryCache) {
      this.memoryCache.clear(namespace);
    }
    if (this.persistentCache) {
      promises.push(
        this.persistentCache.clear(namespace).catch((error) => {
          CacheLogger.warn("Failed to clear persistent cache", error);
          return false;
        })
      );
    }
    if (this.serviceWorkerCache && !namespace) {
      promises.push(
        this.serviceWorkerCache.clear().catch((error) => {
          CacheLogger.warn("Failed to clear service worker cache", error);
          return false;
        })
      );
    }
    await Promise.all(promises);
    CacheLogger.info("Cache cleared", { namespace });
    return true;
  }
  async invalidateByTags(tags) {
    if (this.persistentCache) {
      const items = await this.persistentCache.getByTags(tags);
      CacheLogger.info(`Invalidating ${items.length} items with tags`, { tags });
    }
    await this.clear();
  }
  async getOrSet(key, factory, options = {}) {
    const cached = await this.get(key, options);
    if (cached !== null) {
      return cached;
    }
    let value;
    try {
      value = await factory();
    } catch (error) {
      CacheLogger.error("Cache factory function failed", error);
      throw error;
    }
    await this.set(key, value, options);
    return value;
  }
  calculateSize(value) {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
  async getStats() {
    const stats = {
      operations: this.stats.operations,
      hits: this.stats.hits,
      misses: this.stats.misses,
      plugin: {
        memoryEnabled: !!this.memoryCache,
        persistentEnabled: !!this.persistentCache,
        serviceWorkerEnabled: !!this.serviceWorkerCache,
        autoCleanup: this.options.autoCleanup
      }
    };
    if (this.memoryCache) {
      stats.memory = this.memoryCache.getStats();
    }
    if (this.persistentCache) {
      try {
        stats.persistent = await this.persistentCache.getStats();
      } catch (error) {
        CacheLogger.warn("Failed to get persistent cache stats", error);
      }
    }
    return stats;
  }
  destroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = void 0;
    }
    if (this.memoryCache) {
      this.memoryCache.clear();
      this.memoryCache = void 0;
    }
    if (this.persistentCache && this.persistentCache["db"]) {
      this.persistentCache["db"].close();
      this.persistentCache = void 0;
    }
    CacheLogger.info("Cache plugin destroyed");
  }
}
function stdin_default(fx, options) {
  return new FXCachePlugin(fx, options);
}
