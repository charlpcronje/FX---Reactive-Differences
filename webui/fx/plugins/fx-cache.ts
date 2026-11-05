// /plugins/fx-cache.ts
/**
 * @fx-plugin fx-cache
 * @fx-global $cache
 * @fx-description Multi-tier performance caching with memory and IndexedDB
 * @fx-dependencies
 * @fx-provides $cache
 * @fx-version 1.0.0
 *
 * FX Cache Plugin - TypeScript version with enhanced features
 * Multi-tier caching with IndexedDB, memory, and service worker support
 */

import type { FXCore, FXNodeProxy } from '../fx.v4';

interface CacheOptions {
    namespace?: string;
    ttl?: number;
    tags?: string[];
    priority?: 'memory' | 'persistent' | 'both';
    compress?: boolean;
}

interface CacheRecord {
    key: string;
    namespace: string;
    value: any;
    created: number;
    expiry: number | null;
    tags: string[];
    size: number;
    hits?: number;
    lastAccessed?: number;
}

interface CacheStats {
    totalEntries: number;
    totalSize: number;
    expiredEntries: number;
    namespaces: string[];
    oldestEntry: number | null;
    newestEntry: number | null;
    hitRate?: number;
    missRate?: number;
}

class CacheLogger {
    private static logBuffer: Array<any> = [];
    
    static log(level: string, message: string, data: any = {}): void {
        const entry = { level: level.toUpperCase(), message, data, timestamp: Date.now() };
        this.logBuffer.push(entry);
        console.log(`[FX-CACHE:${entry.level}]`, message, data);
    }
    
    static error(message: string, error: any): void { this.log('error', message, { error }); }
    static warn(message: string, data?: any): void { this.log('warn', message, data); }
    static info(message: string, data?: any): void { this.log('info', message, data); }
    static debug(message: string, data?: any): void { this.log('debug', message, data); }
}

/**
 * Enhanced IndexedDB wrapper with compression support
 */
class IndexedDBCache {
    private dbName: string;
    private version: number;
    private db: IDBDatabase | null = null;
    private isReady: boolean = false;
    private readyPromise: Promise<void>;
    private stats = { hits: 0, misses: 0 };

    constructor(dbName: string = 'fx-cache', version: number = 1) {
        this.dbName = dbName;
        this.version = version;
        this.readyPromise = this.init();
    }

    private async init(): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            
            request.onerror = () => {
                CacheLogger.error('Failed to open IndexedDB', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isReady = true;
                CacheLogger.info('IndexedDB cache initialized');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                
                // Cache store with indexes
                if (!db.objectStoreNames.contains('cache')) {
                    const cacheStore = db.createObjectStore('cache', { keyPath: 'key' });
                    cacheStore.createIndex('namespace', 'namespace', { unique: false });
                    cacheStore.createIndex('expiry', 'expiry', { unique: false });
                    cacheStore.createIndex('created', 'created', { unique: false });
                    cacheStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
                    cacheStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
                }

                // Metadata store
                if (!db.objectStoreNames.contains('metadata')) {
                    db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
        });
    }

    private async ensureReady(): Promise<void> {
        if (!this.isReady) await this.readyPromise;
    }

    private buildKey(namespace: string, key: string): string {
        return `${namespace}:${key}`;
    }

    private calculateSize(value: any): number {
        try {
            return new Blob([JSON.stringify(value)]).size;
        } catch {
            return 0;
        }
    }

    private async compress(value: any): Promise<any> {
        if (typeof value !== 'string') {
            value = JSON.stringify(value);
        }
        
        // Use CompressionStream if available
        if ('CompressionStream' in globalThis) {
            try {
                const blob = new Blob([value]);
                const stream = blob.stream().pipeThrough(new (globalThis as any).CompressionStream('gzip'));
                const compressed = await new Response(stream).blob();
                return await compressed.arrayBuffer();
            } catch {
                return value; // Fallback to uncompressed
            }
        }
        return value;
    }

    private async decompress(value: any): Promise<any> {
        if (value instanceof ArrayBuffer && 'DecompressionStream' in globalThis) {
            try {
                const blob = new Blob([value]);
                const stream = blob.stream().pipeThrough(new (globalThis as any).DecompressionStream('gzip'));
                const decompressed = await new Response(stream).text();
                return JSON.parse(decompressed);
            } catch {
                return value;
            }
        }
        return value;
    }

    async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
        await this.ensureReady();
        
        const {
            namespace = 'default',
            ttl = 24 * 60 * 60 * 1000,
            tags = [],
            compress = false
        } = options;

        const now = Date.now();
        const fullKey = this.buildKey(namespace, key);
        
        const processedValue = compress ? await this.compress(value) : value;
        
        const record: CacheRecord = {
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
            const transaction = this.db!.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');
            const request = store.put(record);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async get(key: string, namespace: string = 'default'): Promise<any> {
        await this.ensureReady();
        
        const fullKey = this.buildKey(namespace, key);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');
            const request = store.get(fullKey);

            request.onsuccess = async () => {
                const record = request.result as CacheRecord | undefined;
                
                if (!record) {
                    this.stats.misses++;
                    resolve(null);
                    return;
                }

                // Check expiry
                if (record.expiry && Date.now() > record.expiry) {
                    this.delete(key, namespace);
                    this.stats.misses++;
                    resolve(null);
                    return;
                }

                // Update stats
                this.stats.hits++;
                record.hits = (record.hits || 0) + 1;
                record.lastAccessed = Date.now();
                store.put(record);

                // Decompress if needed
                const value = record.value instanceof ArrayBuffer 
                    ? await this.decompress(record.value)
                    : record.value;

                resolve(value);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async delete(key: string, namespace: string = 'default'): Promise<boolean> {
        await this.ensureReady();
        
        const fullKey = this.buildKey(namespace, key);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');
            const request = store.delete(fullKey);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async clear(namespace?: string): Promise<boolean> {
        await this.ensureReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');

            if (namespace) {
                const index = store.index('namespace');
                const request = index.openCursor(IDBKeyRange.only(namespace));
                
                request.onsuccess = (event) => {
                    const cursor = (event.target as IDBRequest).result;
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

    async getByTags(tags: string[]): Promise<any[]> {
        await this.ensureReady();
        
        const results: any[] = [];
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readonly');
            const store = transaction.objectStore('cache');
            const index = store.index('tags');
            
            const promises = tags.map(tag => {
                return new Promise((res) => {
                    const request = index.openCursor(IDBKeyRange.only(tag));
                    const tagResults: any[] = [];
                    
                    request.onsuccess = (event) => {
                        const cursor = (event.target as IDBRequest).result;
                        if (cursor) {
                            const record = cursor.value as CacheRecord;
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
            
            Promise.all(promises).then(allResults => {
                resolve(allResults.flat());
            });
        });
    }

    async cleanExpired(): Promise<number> {
        await this.ensureReady();
        
        const now = Date.now();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readwrite');
            const store = transaction.objectStore('cache');
            const index = store.index('expiry');
            
            const request = index.openCursor(IDBKeyRange.upperBound(now));
            let deletedCount = 0;
            
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
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

    async getStats(): Promise<CacheStats> {
        await this.ensureReady();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db!.transaction(['cache'], 'readonly');
            const store = transaction.objectStore('cache');
            const request = store.getAll();

            request.onsuccess = () => {
                const records = request.result as CacheRecord[];
                const now = Date.now();
                
                const stats: CacheStats = {
                    totalEntries: records.length,
                    totalSize: records.reduce((sum, r) => sum + r.size, 0),
                    expiredEntries: records.filter(r => r.expiry && now > r.expiry).length,
                    namespaces: [...new Set(records.map(r => r.namespace))],
                    oldestEntry: records.length > 0 ? Math.min(...records.map(r => r.created)) : null,
                    newestEntry: records.length > 0 ? Math.max(...records.map(r => r.created)) : null,
                    hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
                    missRate: this.stats.misses / (this.stats.hits + this.stats.misses) || 0
                };
                
                resolve(stats);
            };

            request.onerror = () => reject(request.error);
        });
    }
}

/**
 * Enhanced Memory Cache with LRU and advanced features
 */
class MemoryCache {
    private cache: Map<string, CacheRecord> = new Map();
    private accessOrder: Map<string, number> = new Map();
    private maxSize: number;
    private maxMemory: number;
    private currentMemory: number = 0;
    private stats = { hits: 0, misses: 0 };

    constructor(maxSize: number = 1000, maxMemory: number = 50 * 1024 * 1024) {
        this.maxSize = maxSize;
        this.maxMemory = maxMemory;
    }

    set(key: string, value: any, options: CacheOptions = {}): boolean {
        const {
            ttl = 5 * 60 * 1000, // 5 minutes default
            namespace = 'default',
            tags = []
        } = options;

        const fullKey = `${namespace}:${key}`;
        const now = Date.now();
        const size = this.calculateSize(value);
        
        // Check memory limit
        if (this.currentMemory + size > this.maxMemory) {
            this.evictLRU(size);
        }
        
        const record: CacheRecord = {
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

        // Update memory tracking
        const oldRecord = this.cache.get(fullKey);
        if (oldRecord) {
            this.currentMemory -= oldRecord.size;
        }
        this.currentMemory += size;

        this.accessOrder.set(fullKey, now);
        this.cache.set(fullKey, record);

        // Evict if necessary
        this.evictIfNeeded();
        
        return true;
    }

    get(key: string, namespace: string = 'default'): any {
        const fullKey = `${namespace}:${key}`;
        const record = this.cache.get(fullKey);
        
        if (!record) {
            this.stats.misses++;
            return null;
        }

        // Check expiry
        if (record.expiry && Date.now() > record.expiry) {
            this.delete(key, namespace);
            this.stats.misses++;
            return null;
        }

        // Update access tracking
        const now = Date.now();
        this.accessOrder.set(fullKey, now);
        record.hits = (record.hits ?? 0) + 1;
        record.lastAccessed = now;
        this.stats.hits++;
        
        return record.value;
    }

    delete(key: string, namespace: string = 'default'): boolean {
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

    clear(namespace?: string): boolean {
        if (namespace) {
            const keysToDelete: string[] = [];
            for (const [key, record] of this.cache) {
                if (record.namespace === namespace) {
                    keysToDelete.push(key);
                    this.currentMemory -= record.size;
                }
            }
            keysToDelete.forEach(key => {
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

    private calculateSize(value: any): number {
        try {
            return JSON.stringify(value).length * 2; // Rough estimate in bytes
        } catch {
            return 100; // Default size
        }
    }

    private evictIfNeeded(): void {
        if (this.cache.size <= this.maxSize) return;

        const toRemove = this.cache.size - this.maxSize + 1;
        this.evictLRU(0, toRemove);
    }

    private evictLRU(requiredSpace: number, count?: number): void {
        const sortedByAccess = [...this.accessOrder.entries()]
            .sort((a, b) => a[1] - b[1]);

        let freedSpace = 0;
        let removed = 0;
        
        for (const [key] of sortedByAccess) {
            if ((count && removed >= count) || 
                (!count && freedSpace >= requiredSpace)) {
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

    getStats(): CacheStats {
        const now = Date.now();
        const records = [...this.cache.values()];
        
        return {
            totalEntries: this.cache.size,
            totalSize: this.currentMemory,
            expiredEntries: records.filter(r => r.expiry && now > r.expiry).length,
            namespaces: [...new Set(records.map(r => r.namespace))],
            oldestEntry: records.length > 0 ? Math.min(...records.map(r => r.created)) : null,
            newestEntry: records.length > 0 ? Math.max(...records.map(r => r.created)) : null,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0,
            missRate: this.stats.misses / (this.stats.hits + this.stats.misses) || 0
        };
    }
}

/**
 * Service Worker Cache Integration
 */
class ServiceWorkerCache {
    private cacheName: string;
    private isAvailable: boolean = false;

    constructor(cacheName: string = 'fx-cache-v1') {
        this.cacheName = cacheName;
        this.isAvailable = 'caches' in globalThis;
    }

    async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
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
            CacheLogger.error('Service Worker cache set failed', error);
            return false;
        }
    }

    async get(key: string): Promise<any> {
        if (!this.isAvailable) return null;

        try {
            const cache = await caches.open(this.cacheName);
            const response = await cache.match(new Request(key));
            
            if (!response) return null;
            
            const data = await response.json();
            const metadata = data.metadata;
            
            // Check expiry
            if (metadata.ttl && Date.now() > metadata.created + metadata.ttl) {
                await cache.delete(new Request(key));
                return null;
            }
            
            return data.value;
        } catch (error) {
            CacheLogger.error('Service Worker cache get failed', error);
            return null;
        }
    }

    async delete(key: string): Promise<boolean> {
        if (!this.isAvailable) return false;

        try {
            const cache = await caches.open(this.cacheName);
            return await cache.delete(new Request(key));
        } catch (error) {
            CacheLogger.error('Service Worker cache delete failed', error);
            return false;
        }
    }

    async clear(): Promise<boolean> {
        if (!this.isAvailable) return false;

        try {
            return await caches.delete(this.cacheName);
        } catch (error) {
            CacheLogger.error('Service Worker cache clear failed', error);
            return false;
        }
    }
}

/**
 * Main FX Cache Plugin with all tiers
 */
export class FXCachePlugin {
    private fx: FXCore;
    private options: {
        memoryEnabled: boolean;
        persistentEnabled: boolean;
        serviceWorkerEnabled: boolean;
        maxMemorySize: number;
        maxMemoryBytes: number;
        defaultTTL: number;
        autoCleanup: boolean;
        cleanupInterval: number;
        compressionThreshold: number;
    };
    
    public readonly name = 'cache';
    public readonly version = '2.0.0';
    public readonly description = 'Multi-tier caching with compression and service worker support';
    
    private memoryCache?: MemoryCache;
    private persistentCache?: IndexedDBCache;
    private serviceWorkerCache?: ServiceWorkerCache;
    private cleanupTimer?: NodeJS.Timeout;
    private stats = {
        operations: { get: 0, set: 0, delete: 0 },
        hits: { memory: 0, persistent: 0, service: 0 },
        misses: { memory: 0, persistent: 0, service: 0 }
    };

    constructor(fx: FXCore, options: Partial<typeof FXCachePlugin.prototype.options> = {}) {
        this.fx = fx;
        this.options = {
            memoryEnabled: true,
            persistentEnabled: true,
            serviceWorkerEnabled: true,
            maxMemorySize: 1000,
            maxMemoryBytes: 50 * 1024 * 1024, // 50MB
            defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
            autoCleanup: true,
            cleanupInterval: 60 * 60 * 1000, // 1 hour
            compressionThreshold: 1024, // Compress if > 1KB
            ...options
        };
        
        this.init();
    }

    private async init(): Promise<void> {
        try {
            // Initialize memory cache
            if (this.options.memoryEnabled) {
                this.memoryCache = new MemoryCache(
                    this.options.maxMemorySize,
                    this.options.maxMemoryBytes
                );
                CacheLogger.info('Memory cache initialized');
            }

            // Initialize persistent cache
            if (this.options.persistentEnabled && typeof indexedDB !== 'undefined') {
                this.persistentCache = new IndexedDBCache();
                await this.persistentCache['readyPromise'];
                CacheLogger.info('Persistent cache initialized');
            }

            // Initialize service worker cache
            if (this.options.serviceWorkerEnabled && 'caches' in globalThis) {
                this.serviceWorkerCache = new ServiceWorkerCache();
                CacheLogger.info('Service Worker cache initialized');
            }

            // Setup auto cleanup
            if (this.options.autoCleanup) {
                this.setupAutoCleanup();
            }

            CacheLogger.info('FX Cache plugin initialized', {
                memory: !!this.memoryCache,
                persistent: !!this.persistentCache,
                serviceWorker: !!this.serviceWorkerCache
            });
        } catch (error) {
            CacheLogger.error('Failed to initialize cache plugin', error);
        }
    }

    private setupAutoCleanup(): void {
        this.cleanupTimer = setInterval(async () => {
            try {
                if (this.persistentCache) {
                    await this.persistentCache.cleanExpired();
                }
                
                // Clean expired entries from memory
                if (this.memoryCache) {
                    const stats = this.memoryCache.getStats();
                    if (stats.expiredEntries > 0) {
                        CacheLogger.info(`Cleaning ${stats.expiredEntries} expired memory entries`);
                    }
                }
            } catch (error) {
                CacheLogger.error('Auto cleanup failed', error);
            }
        }, this.options.cleanupInterval);
    }

    async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
        this.stats.operations.set++;
        
        const cacheOptions: CacheOptions = {
            ttl: this.options.defaultTTL,
            namespace: 'default',
            priority: 'both',
            compress: this.calculateSize(value) > this.options.compressionThreshold,
            ...options
        };

        const promises: Promise<boolean>[] = [];

        // Store in memory cache
        if (this.memoryCache && cacheOptions.priority !== 'persistent') {
            try {
                this.memoryCache.set(key, value, cacheOptions);
            } catch (error) {
                CacheLogger.warn('Failed to set memory cache', error);
            }
        }

        // Store in persistent cache
        if (this.persistentCache && cacheOptions.priority !== 'memory') {
            promises.push(
                this.persistentCache.set(key, value, cacheOptions)
                    .catch(error => {
                        CacheLogger.warn('Failed to set persistent cache', error);
                        return false;
                    })
            );
        }

        // Store in service worker cache for large/important items
        if (this.serviceWorkerCache && cacheOptions.priority === 'both') {
            promises.push(
                this.serviceWorkerCache.set(key, value, cacheOptions)
                    .catch(error => {
                        CacheLogger.warn('Failed to set service worker cache', error);
                        return false;
                    })
            );
        }

        const results = await Promise.all(promises);
        return results.some(r => r === true);
    }

    async get(key: string, options: { namespace?: string; skipMemory?: boolean; skipPersistent?: boolean } = {}): Promise<any> {
        this.stats.operations.get++;
        
        const { namespace = 'default', skipMemory = false, skipPersistent = false } = options;

        // Try memory cache first
        if (this.memoryCache && !skipMemory) {
            const memoryResult = this.memoryCache.get(key, namespace);
            if (memoryResult !== null) {
                this.stats.hits.memory++;
                CacheLogger.debug('Cache hit (memory)', { key, namespace });
                return memoryResult;
            }
            this.stats.misses.memory++;
        }

        // Try persistent cache
        if (this.persistentCache && !skipPersistent) {
            try {
                const persistentResult = await this.persistentCache.get(key, namespace);
                if (persistentResult !== null) {
                    this.stats.hits.persistent++;
                    CacheLogger.debug('Cache hit (persistent)', { key, namespace });
                    
                    // Promote to memory cache
                    if (this.memoryCache && !skipMemory) {
                        this.memoryCache.set(key, persistentResult, { namespace });
                    }
                    
                    return persistentResult;
                }
                this.stats.misses.persistent++;
            } catch (error) {
                CacheLogger.warn('Failed to get from persistent cache', error);
            }
        }

        // Try service worker cache
        if (this.serviceWorkerCache) {
            try {
                const swResult = await this.serviceWorkerCache.get(`${namespace}:${key}`);
                if (swResult !== null) {
                    this.stats.hits.service++;
                    CacheLogger.debug('Cache hit (service worker)', { key, namespace });
                    return swResult;
                }
                this.stats.misses.service++;
            } catch (error) {
                CacheLogger.warn('Failed to get from service worker cache', error);
            }
        }

        CacheLogger.debug('Cache miss', { key, namespace });
        return null;
    }

    async delete(key: string, options: { namespace?: string } = {}): Promise<boolean> {
        this.stats.operations.delete++;
        
        const { namespace = 'default' } = options;
        const promises: Promise<boolean>[] = [];

        if (this.memoryCache) {
            this.memoryCache.delete(key, namespace);
        }

        if (this.persistentCache) {
            promises.push(
                this.persistentCache.delete(key, namespace)
                    .catch(error => {
                        CacheLogger.warn('Failed to delete from persistent cache', error);
                        return false;
                    })
            );
        }

        if (this.serviceWorkerCache) {
            promises.push(
                this.serviceWorkerCache.delete(`${namespace}:${key}`)
                    .catch(error => {
                        CacheLogger.warn('Failed to delete from service worker cache', error);
                        return false;
                    })
            );
        }

        await Promise.all(promises);
        return true;
    }

    async clear(namespace?: string): Promise<boolean> {
        const promises: Promise<boolean>[] = [];

        if (this.memoryCache) {
            this.memoryCache.clear(namespace);
        }

        if (this.persistentCache) {
            promises.push(
                this.persistentCache.clear(namespace)
                    .catch(error => {
                        CacheLogger.warn('Failed to clear persistent cache', error);
                        return false;
                    })
            );
        }

        if (this.serviceWorkerCache && !namespace) {
            promises.push(
                this.serviceWorkerCache.clear()
                    .catch(error => {
                        CacheLogger.warn('Failed to clear service worker cache', error);
                        return false;
                    })
            );
        }

        await Promise.all(promises);
        CacheLogger.info('Cache cleared', { namespace });
        return true;
    }

    async invalidateByTags(tags: string[]): Promise<void> {
        if (this.persistentCache) {
            const items = await this.persistentCache.getByTags(tags);
            CacheLogger.info(`Invalidating ${items.length} items with tags`, { tags });
        }
        
        // For now, clear all as tag-based invalidation needs more implementation
        await this.clear();
    }

    async getOrSet(key: string, factory: () => Promise<any>, options: CacheOptions = {}): Promise<any> {
        const cached = await this.get(key, options);
        if (cached !== null) {
            return cached;
        }

        let value: any;
        try {
            value = await factory();
        } catch (error) {
            CacheLogger.error('Cache factory function failed', error);
            throw error;
        }

        await this.set(key, value, options);
        return value;
    }

    private calculateSize(value: any): number {
        try {
            return JSON.stringify(value).length;
        } catch {
            return 0;
        }
    }

    async getStats(): Promise<{
        memory?: CacheStats;
        persistent?: CacheStats;
        operations: typeof FXCachePlugin.prototype.stats.operations;
        hits: typeof FXCachePlugin.prototype.stats.hits;
        misses: typeof FXCachePlugin.prototype.stats.misses;
        plugin: {
            memoryEnabled: boolean;
            persistentEnabled: boolean;
            serviceWorkerEnabled: boolean;
            autoCleanup: boolean;
        };
    }> {
        const stats: any = {
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
                CacheLogger.warn('Failed to get persistent cache stats', error);
            }
        }

        return stats;
    }

    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        if (this.memoryCache) {
            this.memoryCache.clear();
            this.memoryCache = undefined;
        }

        if (this.persistentCache && this.persistentCache['db']) {
            this.persistentCache['db'].close();
            this.persistentCache = undefined;
        }

        CacheLogger.info('Cache plugin destroyed');
    }
}

// Export plugin factory
export default function(fx: FXCore, options?: Partial<FXCachePlugin['options']>): FXCachePlugin {
    return new FXCachePlugin(fx, options);
}