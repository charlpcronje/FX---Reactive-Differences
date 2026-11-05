/**
 * fx-filesystem.ts - Filesystem Plugin for FX Framework
 *
 * Enables cross-language IPC by mirroring FX nodes to a shared filesystem directory
 * (ideally a RamDisk like /dev/shm for performance). Compatible with Rust, Go, PHP, and Python
 * implementations of FX.
 *
 * @module fx-filesystem
 * @version 2.0.0
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import type { FSWatcher } from 'chokidar';

// Type definitions
interface FilesystemConfig {
  baseDir: string;
  autoSync: boolean;
  watchChanges: boolean;
  fileExtension: string;
  metadataFile: string;
  syncInterval: number;
  maxFileSize: number;
  backupEnabled: boolean;
  backupInterval: number;
  backupRetention: number;
  useRamDisk: boolean;
  debounceDelay: number;
}

interface NodeMetadata {
  __id: string;
  __parent_id?: string;
  __type?: string;
  __proto: string[];
  __timestamp: number;
  __fx_version: string;
  __file_path: string;
  __file_size: number;
  __watchers_count?: number;
  __effects_count?: number;
  __meta?: Record<string, any>;
}

interface NodeValue {
  type: 'null' | 'number' | 'string' | 'boolean' | 'object' | 'array' | 'function' | 'symbol' | 'bigint' | 'undefined';
  mimeType?: string;
  content: any;
  size: number;
  encoding?: string;
}

interface PluginStats {
  syncOperations: number;
  fileOperations: number;
  backupCount: number;
  errors: number;
  lastSync?: Date;
  lastBackup?: Date;
  nodesTracked: number;
  totalBytes: number;
}

interface FXNode {
  id: string;
  val: () => any;
  watch: (callback: (value: any) => void) => () => void;
  nodes?: Map<string, FXNode>;
  parent_id?: string;
  _meta?: Record<string, any>;
}

interface FXCore {
  proxy: (path: string) => any;
  root: FXNode;
  on?: (event: string, callback: (...args: any[]) => void) => void;
  off?: (event: string, callback: (...args: any[]) => void) => void;
}

/**
 * Default configuration for the filesystem plugin
 */
export const defaultConfig: FilesystemConfig = {
  baseDir: '/tmp/fx-nodes',
  autoSync: true,
  watchChanges: true,
  fileExtension: '.fxval',
  metadataFile: '.fxmeta',
  syncInterval: 1000, // 1 second
  maxFileSize: 10 * 1024 * 1024, // 10MB
  backupEnabled: true,
  backupInterval: 300000, // 5 minutes
  backupRetention: 5,
  useRamDisk: true, // Prefer RamDisk for performance
  debounceDelay: 100, // 100ms debounce for file changes
};

/**
 * FilesystemPlugin - Mirrors FX nodes to filesystem for cross-language IPC
 */
export class FilesystemPlugin {
  private config: FilesystemConfig;
  private fx?: FXCore;
  private nodePathMap: Map<string, string> = new Map();
  private pathNodeMap: Map<string, string> = new Map();
  private syncQueue: Set<string> = new Set();
  private watcher?: FSWatcher;
  private running: boolean = true;
  private stats: PluginStats;
  private syncInterval?: NodeJS.Timeout;
  private backupInterval?: NodeJS.Timeout;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private watchUnsubscribers: Map<string, () => void> = new Map();

  constructor(config: Partial<FilesystemConfig> = {}) {
    this.config = { ...defaultConfig, ...config };
    this.stats = {
      syncOperations: 0,
      fileOperations: 0,
      backupCount: 0,
      errors: 0,
      nodesTracked: 0,
      totalBytes: 0,
    };
  }

  /**
   * Initialize the plugin with an FX core instance
   */
  async init(fx: FXCore): Promise<void> {
    this.fx = fx;

    // Browser has no filesystem — skip init silently. Plugin still loads;
    // its file methods will throw if called, which is correct behavior.
    if (typeof window !== "undefined" && typeof (globalThis as any).Deno === "undefined" && typeof (globalThis as any).process === "undefined") {
      console.log(`[fx-filesystem] Browser environment — filesystem operations disabled`);
      return;
    }

    // Ensure base directory exists
    await this.ensureBaseDir();

    // Load existing nodes from disk
    await this.loadAllNodes();

    // Setup watchers for FX nodes
    if (this.config.autoSync) {
      this.setupNodeWatchers();
    }

    // Setup filesystem watcher
    if (this.config.watchChanges) {
      await this.setupFilesystemWatcher();
    }

    // Start sync worker
    if (this.config.autoSync) {
      this.startSyncWorker();
    }

    // Start backup worker
    if (this.config.backupEnabled) {
      this.startBackupWorker();
    }

    console.log(`[fx-filesystem] Initialized with base directory: ${this.config.baseDir}`);
  }

  /**
   * Ensure the base directory exists
   */
  private async ensureBaseDir(): Promise<void> {
    try {
      await fs.mkdir(this.config.baseDir, { recursive: true });
    } catch (error) {
      console.error(`[fx-filesystem] Failed to create base directory:`, error);
      throw error;
    }
  }

  /**
   * Get filesystem path for a node ID
   */
  private getNodePath(nodeId: string): string {
    // Sanitize node ID to create a valid filesystem path
    const sanitized = nodeId.replace(/[$.\\/]/g, '_');
    return path.join(this.config.baseDir, sanitized);
  }

  /**
   * Write node metadata to disk
   */
  private async writeNodeMetadata(node: FXNode, nodePath: string): Promise<void> {
    const metadata: NodeMetadata = {
      __id: node.id,
      __parent_id: node.parent_id,
      __type: typeof node.val(),
      __proto: [],
      __timestamp: Date.now() * 1000000, // Nanoseconds for compatibility
      __fx_version: '2.0.0',
      __file_path: nodePath,
      __file_size: 0,
      __meta: node._meta,
    };

    const metaPath = path.join(nodePath, this.config.metadataFile);
    const json = JSON.stringify(metadata, null, 2);

    await fs.writeFile(metaPath, json, 'utf-8');
  }

  /**
   * Write node value to disk
   */
  private async writeNodeValue(node: FXNode, nodePath: string): Promise<void> {
    const value = node.val();
    const nodeValue: NodeValue = {
      type: this.getValueType(value),
      content: this.serializeValue(value),
      size: 0,
    };

    const json = JSON.stringify(nodeValue, null, 2);

    // Check file size
    if (json.length > this.config.maxFileSize) {
      throw new Error(`Value too large: ${json.length} bytes`);
    }

    nodeValue.size = json.length;

    const valuePath = path.join(nodePath, `value${this.config.fileExtension}`);
    await fs.writeFile(valuePath, json, 'utf-8');

    this.stats.fileOperations++;
    this.stats.totalBytes += json.length;
  }

  /**
   * Get the type of a value
   */
  private getValueType(value: any): NodeValue['type'] {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    return typeof value as NodeValue['type'];
  }

  /**
   * Serialize a value for storage
   */
  private serializeValue(value: any): any {
    if (typeof value === 'function') {
      return { __type: 'function', name: value.name };
    }
    if (typeof value === 'symbol') {
      return { __type: 'symbol', description: value.description };
    }
    if (typeof value === 'bigint') {
      return { __type: 'bigint', value: value.toString() };
    }
    return value;
  }

  /**
   * Deserialize a value from storage
   */
  private deserializeValue(nodeValue: NodeValue): any {
    const { type, content } = nodeValue;

    if (type === 'null') return null;
    if (type === 'undefined') return undefined;

    if (typeof content === 'object' && content !== null) {
      if (content.__type === 'bigint') {
        return BigInt(content.value);
      }
      if (content.__type === 'function') {
        return undefined; // Can't deserialize functions
      }
      if (content.__type === 'symbol') {
        return Symbol(content.description);
      }
    }

    return content;
  }

  /**
   * Sync a node to disk
   */
  private async syncNodeToDisk(node: FXNode): Promise<void> {
    const nodePath = this.getNodePath(node.id);

    try {
      // Create directory for node
      await fs.mkdir(nodePath, { recursive: true });

      // Store mappings
      this.nodePathMap.set(node.id, nodePath);
      this.pathNodeMap.set(nodePath, node.id);

      // Write metadata and value
      await this.writeNodeMetadata(node, nodePath);
      await this.writeNodeValue(node, nodePath);

      // Sync children recursively
      if (node.nodes) {
        for (const [, child] of node.nodes) {
          await this.syncNodeToDisk(child);
        }
      }

      this.stats.syncOperations++;
      this.stats.lastSync = new Date();
      this.stats.nodesTracked++;

    } catch (error) {
      console.error(`[fx-filesystem] Failed to sync node ${node.id}:`, error);
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Load a node from disk
   */
  private async loadNodeFromDisk(nodePath: string): Promise<void> {
    const metaPath = path.join(nodePath, this.config.metadataFile);

    try {
      // Check if metadata exists
      if (!fsSync.existsSync(metaPath)) {
        return;
      }

      // Read metadata
      const metadataStr = await fs.readFile(metaPath, 'utf-8');
      const metadata: NodeMetadata = JSON.parse(metadataStr);

      // Read value
      const valuePath = path.join(nodePath, `value${this.config.fileExtension}`);
      if (fsSync.existsSync(valuePath)) {
        const valueStr = await fs.readFile(valuePath, 'utf-8');
        const nodeValue: NodeValue = JSON.parse(valueStr);
        const value = this.deserializeValue(nodeValue);

        // Set value in FX
        if (this.fx) {
          const proxy = this.fx.proxy(metadata.__id);
          if (typeof proxy.val === 'function' && proxy.val.length > 0) {
            proxy.val(value);
          }
        }
      }

      // Load children recursively
      const entries = await fs.readdir(nodePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const childPath = path.join(nodePath, entry.name);
          await this.loadNodeFromDisk(childPath);
        }
      }

    } catch (error) {
      console.error(`[fx-filesystem] Failed to load node from ${nodePath}:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Load all nodes from disk
   */
  private async loadAllNodes(): Promise<void> {
    try {
      const entries = await fs.readdir(this.config.baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const nodePath = path.join(this.config.baseDir, entry.name);
          await this.loadNodeFromDisk(nodePath);
        }
      }

      console.log(`[fx-filesystem] Loaded ${this.stats.nodesTracked} nodes from disk`);
    } catch (error) {
      console.error(`[fx-filesystem] Failed to load nodes:`, error);
    }
  }

  /**
   * Setup watchers for FX nodes
   */
  private setupNodeWatchers(): void {
    if (!this.fx) return;

    // Watch for structure changes
    if (this.fx.on) {
      this.fx.on('structure:add', (event: any) => {
        this.queueNodeSync(event.nodeId);
      });

      this.fx.on('structure:remove', (event: any) => {
        this.queueNodeRemoval(event.nodeId);
      });
    }

    // Setup recursive watchers starting from root
    this.watchNodeRecursive(this.fx.root);
  }

  /**
   * Watch a node and its children recursively
   */
  private watchNodeRecursive(node: FXNode): void {
    // Watch this node's value changes
    if (node.watch) {
      const unsubscribe = node.watch(() => {
        this.queueNodeSync(node.id);
      });
      this.watchUnsubscribers.set(node.id, unsubscribe);
    }

    // Watch children
    if (node.nodes) {
      for (const [, child] of node.nodes) {
        this.watchNodeRecursive(child);
      }
    }
  }

  /**
   * Queue a node for synchronization
   */
  private queueNodeSync(nodeId: string): void {
    this.syncQueue.add(nodeId);
  }

  /**
   * Queue a node for removal
   */
  private async queueNodeRemoval(nodeId: string): Promise<void> {
    const nodePath = this.nodePathMap.get(nodeId);
    if (nodePath) {
      try {
        await fs.rm(nodePath, { recursive: true, force: true });
        this.nodePathMap.delete(nodeId);
        this.pathNodeMap.delete(nodePath);
      } catch (error) {
        console.error(`[fx-filesystem] Failed to remove node ${nodeId}:`, error);
      }
    }
  }

  /**
   * Start the sync worker
   */
  private startSyncWorker(): void {
    this.syncInterval = setInterval(async () => {
      if (!this.running || this.syncQueue.size === 0) return;

      const nodesToSync = Array.from(this.syncQueue);
      this.syncQueue.clear();

      for (const nodeId of nodesToSync) {
        try {
          if (!this.fx) continue;

          const proxy = this.fx.proxy(nodeId);
          const node = proxy._node || proxy;

          if (node) {
            await this.syncNodeToDisk(node);
          }
        } catch (error) {
          console.error(`[fx-filesystem] Failed to sync node ${nodeId}:`, error);
          this.stats.errors++;
        }
      }
    }, this.config.syncInterval);
  }

  /**
   * Setup filesystem watcher for bidirectional sync
   */
  private async setupFilesystemWatcher(): Promise<void> {
    try {
      // Dynamically import chokidar (works in both Node.js and bundled environments)
      const chokidar = await import('chokidar');

      this.watcher = chokidar.watch(this.config.baseDir, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.config.debounceDelay,
          pollInterval: 50,
        },
      });

      this.watcher.on('change', (filePath: string) => {
        this.handleFileChange(filePath);
      });

      this.watcher.on('add', (filePath: string) => {
        this.handleFileChange(filePath);
      });

      this.watcher.on('unlink', (filePath: string) => {
        this.handleFileRemoval(filePath);
      });

      console.log(`[fx-filesystem] Filesystem watcher started`);
    } catch (error) {
      console.error(`[fx-filesystem] Failed to setup filesystem watcher:`, error);
      // Watcher is optional, continue without it
    }
  }

  /**
   * Handle file changes from filesystem
   */
  private handleFileChange(filePath: string): void {
    // Debounce rapid changes
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);

      // Only process value files
      if (!filePath.endsWith(this.config.fileExtension)) return;

      const nodePath = path.dirname(filePath);
      const nodeId = this.pathNodeMap.get(nodePath);

      if (nodeId && this.fx) {
        try {
          // Read updated value
          const valueStr = await fs.readFile(filePath, 'utf-8');
          const nodeValue: NodeValue = JSON.parse(valueStr);
          const value = this.deserializeValue(nodeValue);

          // Update FX node
          const proxy = this.fx.proxy(nodeId);
          if (typeof proxy.val === 'function' && proxy.val.length > 0) {
            proxy.val(value);
          }
        } catch (error) {
          console.error(`[fx-filesystem] Failed to handle file change for ${filePath}:`, error);
        }
      }
    }, this.config.debounceDelay);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Handle file removal from filesystem
   */
  private handleFileRemoval(filePath: string): void {
    const nodePath = path.dirname(filePath);
    const nodeId = this.pathNodeMap.get(nodePath);

    if (nodeId) {
      this.nodePathMap.delete(nodeId);
      this.pathNodeMap.delete(nodePath);
    }
  }

  /**
   * Start the backup worker
   */
  private startBackupWorker(): void {
    this.backupInterval = setInterval(async () => {
      await this.createBackup();
    }, this.config.backupInterval);
  }

  /**
   * Create a backup of the entire state
   */
  private async createBackup(): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(this.config.baseDir, '..', `fx-backup-${timestamp}`);

      // Copy entire directory
      await this.copyDirectory(this.config.baseDir, backupDir);

      this.stats.backupCount++;
      this.stats.lastBackup = new Date();

      // Cleanup old backups
      await this.cleanupOldBackups();

      console.log(`[fx-filesystem] Backup created: ${backupDir}`);
    } catch (error) {
      console.error(`[fx-filesystem] Failed to create backup:`, error);
      this.stats.errors++;
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Cleanup old backups beyond retention limit
   */
  private async cleanupOldBackups(): Promise<void> {
    try {
      const parentDir = path.dirname(this.config.baseDir);
      const entries = await fs.readdir(parentDir, { withFileTypes: true });

      const backups = entries
        .filter(e => e.isDirectory() && e.name.startsWith('fx-backup-'))
        .map(e => ({
          name: e.name,
          path: path.join(parentDir, e.name),
        }))
        .sort((a, b) => b.name.localeCompare(a.name)); // Newest first

      // Remove old backups
      if (backups.length > this.config.backupRetention) {
        const toRemove = backups.slice(this.config.backupRetention);
        for (const backup of toRemove) {
          await fs.rm(backup.path, { recursive: true, force: true });
        }
      }
    } catch (error) {
      console.error(`[fx-filesystem] Failed to cleanup old backups:`, error);
    }
  }

  /**
   * Manually sync a specific node
   */
  async syncNode(nodeId: string): Promise<void> {
    if (!this.fx) {
      throw new Error('Plugin not initialized');
    }

    const proxy = this.fx.proxy(nodeId);
    const node = proxy._node || proxy;

    if (node) {
      await this.syncNodeToDisk(node);
    }
  }

  /**
   * Get plugin statistics
   */
  getStats(): PluginStats {
    return { ...this.stats };
  }

  /**
   * Cleanup and shutdown the plugin
   */
  async destroy(): Promise<void> {
    this.running = false;

    // Clear intervals
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    // Clear debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Unsubscribe from all watchers
    for (const unsubscribe of this.watchUnsubscribers.values()) {
      unsubscribe();
    }
    this.watchUnsubscribers.clear();

    // Close filesystem watcher
    if (this.watcher) {
      await this.watcher.close();
    }

    console.log(`[fx-filesystem] Plugin destroyed`);
  }
}

/**
 * Factory function to create and initialize the plugin
 */
export async function createFilesystemPlugin(
  fx: FXCore,
  config: Partial<FilesystemConfig> = {}
): Promise<FilesystemPlugin> {
  const plugin = new FilesystemPlugin(config);
  await plugin.init(fx);
  return plugin;
}

/**
 * Default export for easy usage
 */
export default createFilesystemPlugin;
