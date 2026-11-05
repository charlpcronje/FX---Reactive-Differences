var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var stdin_exports = {};
__export(stdin_exports, {
  FilesystemPlugin: () => FilesystemPlugin,
  createFilesystemPlugin: () => createFilesystemPlugin,
  default: () => stdin_default,
  defaultConfig: () => defaultConfig
});
module.exports = __toCommonJS(stdin_exports);
var fs = __toESM(require("fs/promises"));
var fsSync = __toESM(require("fs"));
var path = __toESM(require("path"));
const defaultConfig = {
  baseDir: "/tmp/fx-nodes",
  autoSync: true,
  watchChanges: true,
  fileExtension: ".fxval",
  metadataFile: ".fxmeta",
  syncInterval: 1e3,
  // 1 second
  maxFileSize: 10 * 1024 * 1024,
  // 10MB
  backupEnabled: true,
  backupInterval: 3e5,
  // 5 minutes
  backupRetention: 5,
  useRamDisk: true,
  // Prefer RamDisk for performance
  debounceDelay: 100
  // 100ms debounce for file changes
};
class FilesystemPlugin {
  config;
  fx;
  nodePathMap = /* @__PURE__ */ new Map();
  pathNodeMap = /* @__PURE__ */ new Map();
  syncQueue = /* @__PURE__ */ new Set();
  watcher;
  running = true;
  stats;
  syncInterval;
  backupInterval;
  debounceTimers = /* @__PURE__ */ new Map();
  watchUnsubscribers = /* @__PURE__ */ new Map();
  constructor(config = {}) {
    this.config = { ...defaultConfig, ...config };
    this.stats = {
      syncOperations: 0,
      fileOperations: 0,
      backupCount: 0,
      errors: 0,
      nodesTracked: 0,
      totalBytes: 0
    };
  }
  /**
   * Initialize the plugin with an FX core instance
   */
  async init(fx) {
    this.fx = fx;
    if (typeof window !== "undefined" && typeof globalThis.Deno === "undefined" && typeof globalThis.process === "undefined") {
      console.log("[fx-filesystem] Browser environment — filesystem operations disabled");
      return;
    }
    await this.ensureBaseDir();
    await this.loadAllNodes();
    if (this.config.autoSync) {
      this.setupNodeWatchers();
    }
    if (this.config.watchChanges) {
      await this.setupFilesystemWatcher();
    }
    if (this.config.autoSync) {
      this.startSyncWorker();
    }
    if (this.config.backupEnabled) {
      this.startBackupWorker();
    }
    console.log(`[fx-filesystem] Initialized with base directory: ${this.config.baseDir}`);
  }
  /**
   * Ensure the base directory exists
   */
  async ensureBaseDir() {
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
  getNodePath(nodeId) {
    const sanitized = nodeId.replace(/[$.\\/]/g, "_");
    return path.join(this.config.baseDir, sanitized);
  }
  /**
   * Write node metadata to disk
   */
  async writeNodeMetadata(node, nodePath) {
    const metadata = {
      __id: node.id,
      __parent_id: node.parent_id,
      __type: typeof node.val(),
      __proto: [],
      __timestamp: Date.now() * 1e6,
      // Nanoseconds for compatibility
      __fx_version: "2.0.0",
      __file_path: nodePath,
      __file_size: 0,
      __meta: node._meta
    };
    const metaPath = path.join(nodePath, this.config.metadataFile);
    const json = JSON.stringify(metadata, null, 2);
    await fs.writeFile(metaPath, json, "utf-8");
  }
  /**
   * Write node value to disk
   */
  async writeNodeValue(node, nodePath) {
    const value = node.val();
    const nodeValue = {
      type: this.getValueType(value),
      content: this.serializeValue(value),
      size: 0
    };
    const json = JSON.stringify(nodeValue, null, 2);
    if (json.length > this.config.maxFileSize) {
      throw new Error(`Value too large: ${json.length} bytes`);
    }
    nodeValue.size = json.length;
    const valuePath = path.join(nodePath, `value${this.config.fileExtension}`);
    await fs.writeFile(valuePath, json, "utf-8");
    this.stats.fileOperations++;
    this.stats.totalBytes += json.length;
  }
  /**
   * Get the type of a value
   */
  getValueType(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
  /**
   * Serialize a value for storage
   */
  serializeValue(value) {
    if (typeof value === "function") {
      return { __type: "function", name: value.name };
    }
    if (typeof value === "symbol") {
      return { __type: "symbol", description: value.description };
    }
    if (typeof value === "bigint") {
      return { __type: "bigint", value: value.toString() };
    }
    return value;
  }
  /**
   * Deserialize a value from storage
   */
  deserializeValue(nodeValue) {
    const { type, content } = nodeValue;
    if (type === "null") return null;
    if (type === "undefined") return void 0;
    if (typeof content === "object" && content !== null) {
      if (content.__type === "bigint") {
        return BigInt(content.value);
      }
      if (content.__type === "function") {
        return void 0;
      }
      if (content.__type === "symbol") {
        return Symbol(content.description);
      }
    }
    return content;
  }
  /**
   * Sync a node to disk
   */
  async syncNodeToDisk(node) {
    const nodePath = this.getNodePath(node.id);
    try {
      await fs.mkdir(nodePath, { recursive: true });
      this.nodePathMap.set(node.id, nodePath);
      this.pathNodeMap.set(nodePath, node.id);
      await this.writeNodeMetadata(node, nodePath);
      await this.writeNodeValue(node, nodePath);
      if (node.nodes) {
        for (const [, child] of node.nodes) {
          await this.syncNodeToDisk(child);
        }
      }
      this.stats.syncOperations++;
      this.stats.lastSync = /* @__PURE__ */ new Date();
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
  async loadNodeFromDisk(nodePath) {
    const metaPath = path.join(nodePath, this.config.metadataFile);
    try {
      if (!fsSync.existsSync(metaPath)) {
        return;
      }
      const metadataStr = await fs.readFile(metaPath, "utf-8");
      const metadata = JSON.parse(metadataStr);
      const valuePath = path.join(nodePath, `value${this.config.fileExtension}`);
      if (fsSync.existsSync(valuePath)) {
        const valueStr = await fs.readFile(valuePath, "utf-8");
        const nodeValue = JSON.parse(valueStr);
        const value = this.deserializeValue(nodeValue);
        if (this.fx) {
          const proxy = this.fx.proxy(metadata.__id);
          if (typeof proxy.val === "function" && proxy.val.length > 0) {
            proxy.val(value);
          }
        }
      }
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
  async loadAllNodes() {
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
  setupNodeWatchers() {
    if (!this.fx) return;
    if (this.fx.on) {
      this.fx.on("structure:add", (event) => {
        this.queueNodeSync(event.nodeId);
      });
      this.fx.on("structure:remove", (event) => {
        this.queueNodeRemoval(event.nodeId);
      });
    }
    this.watchNodeRecursive(this.fx.root);
  }
  /**
   * Watch a node and its children recursively
   */
  watchNodeRecursive(node) {
    if (node.watch) {
      const unsubscribe = node.watch(() => {
        this.queueNodeSync(node.id);
      });
      this.watchUnsubscribers.set(node.id, unsubscribe);
    }
    if (node.nodes) {
      for (const [, child] of node.nodes) {
        this.watchNodeRecursive(child);
      }
    }
  }
  /**
   * Queue a node for synchronization
   */
  queueNodeSync(nodeId) {
    this.syncQueue.add(nodeId);
  }
  /**
   * Queue a node for removal
   */
  async queueNodeRemoval(nodeId) {
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
  startSyncWorker() {
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
  async setupFilesystemWatcher() {
    try {
      const chokidar = await import("chokidar");
      this.watcher = chokidar.watch(this.config.baseDir, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: this.config.debounceDelay,
          pollInterval: 50
        }
      });
      this.watcher.on("change", (filePath) => {
        this.handleFileChange(filePath);
      });
      this.watcher.on("add", (filePath) => {
        this.handleFileChange(filePath);
      });
      this.watcher.on("unlink", (filePath) => {
        this.handleFileRemoval(filePath);
      });
      console.log(`[fx-filesystem] Filesystem watcher started`);
    } catch (error) {
      console.error(`[fx-filesystem] Failed to setup filesystem watcher:`, error);
    }
  }
  /**
   * Handle file changes from filesystem
   */
  handleFileChange(filePath) {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(filePath);
      if (!filePath.endsWith(this.config.fileExtension)) return;
      const nodePath = path.dirname(filePath);
      const nodeId = this.pathNodeMap.get(nodePath);
      if (nodeId && this.fx) {
        try {
          const valueStr = await fs.readFile(filePath, "utf-8");
          const nodeValue = JSON.parse(valueStr);
          const value = this.deserializeValue(nodeValue);
          const proxy = this.fx.proxy(nodeId);
          if (typeof proxy.val === "function" && proxy.val.length > 0) {
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
  handleFileRemoval(filePath) {
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
  startBackupWorker() {
    this.backupInterval = setInterval(async () => {
      await this.createBackup();
    }, this.config.backupInterval);
  }
  /**
   * Create a backup of the entire state
   */
  async createBackup() {
    try {
      const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-");
      const backupDir = path.join(this.config.baseDir, "..", `fx-backup-${timestamp}`);
      await this.copyDirectory(this.config.baseDir, backupDir);
      this.stats.backupCount++;
      this.stats.lastBackup = /* @__PURE__ */ new Date();
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
  async copyDirectory(src, dest) {
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
  async cleanupOldBackups() {
    try {
      const parentDir = path.dirname(this.config.baseDir);
      const entries = await fs.readdir(parentDir, { withFileTypes: true });
      const backups = entries.filter((e) => e.isDirectory() && e.name.startsWith("fx-backup-")).map((e) => ({
        name: e.name,
        path: path.join(parentDir, e.name)
      })).sort((a, b) => b.name.localeCompare(a.name));
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
  async syncNode(nodeId) {
    if (!this.fx) {
      throw new Error("Plugin not initialized");
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
  getStats() {
    return { ...this.stats };
  }
  /**
   * Cleanup and shutdown the plugin
   */
  async destroy() {
    this.running = false;
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const unsubscribe of this.watchUnsubscribers.values()) {
      unsubscribe();
    }
    this.watchUnsubscribers.clear();
    if (this.watcher) {
      await this.watcher.close();
    }
    console.log(`[fx-filesystem] Plugin destroyed`);
  }
}
async function createFilesystemPlugin(fx, config = {}) {
  const plugin = new FilesystemPlugin(config);
  await plugin.init(fx);
  return plugin;
}
var stdin_default = createFilesystemPlugin;
