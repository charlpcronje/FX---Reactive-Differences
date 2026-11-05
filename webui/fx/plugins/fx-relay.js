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
  FXRelayPlugin: () => FXRelayPlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
var import_msgpack_lite = __toESM(require("msgpack-lite"));
class FXRelayPlugin {
  name = "relay";
  version = "1.0.0";
  description = "Binary delta patch relay client";
  fx;
  ws = null;
  subscriptions = /* @__PURE__ */ new Set();
  hooks;
  options;
  state = "disconnected";
  reconnectAttempts = 0;
  reconnectTimer = null;
  patchQueue = [];
  processingQueue = false;
  // Stats tracking
  stats = {
    patchesReceived: 0,
    patchesApplied: 0,
    patchesFailed: 0,
    bytesReceived: 0,
    lastPatchTime: 0
  };
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      url: options.url || "ws://127.0.0.1:9876",
      autoConnect: options.autoConnect !== false,
      autoReconnect: options.autoReconnect !== false,
      reconnectDelay: options.reconnectDelay || 1e3,
      maxReconnectAttempts: options.maxReconnectAttempts || 0,
      debug: options.debug || false,
      useMsgpack: options.useMsgpack !== false
    };
    this.hooks = {
      before: [],
      update: [],
      after: []
    };
    this.initializeStats();
    if (this.options.autoConnect) {
      this.connect();
    }
  }
  // ==========================================
  // Connection Management
  // ==========================================
  /**
   * Connect to WebSocket server
   */
  connect(url) {
    if (this.ws && this.state === "connected") {
      this.log("Already connected");
      return;
    }
    const wsUrl = url || this.options.url;
    this.log(`Connecting to ${wsUrl}`);
    this.setState("connecting");
    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onclose = (event) => this.handleClose(event);
    } catch (error) {
      this.error("Connection failed:", error);
      this.setState("error");
      this.scheduleReconnect();
    }
  }
  /**
   * Disconnect from WebSocket server
   */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
    this.log("Disconnected");
  }
  /**
   * Get current connection state
   */
  getState() {
    return this.state;
  }
  /**
   * Check if connected
   */
  isConnected() {
    return this.state === "connected" && this.ws?.readyState === WebSocket.OPEN;
  }
  // ==========================================
  // Subscription Management
  // ==========================================
  /**
   * Subscribe to a node path pattern
   * Supports:
   * - "exact.path" - exact match
   * - "path.*" - single-level wildcard
   * - "path.**" - recursive wildcard
   * - "**" - match everything
   */
  subscribe(path) {
    this.subscriptions.add(path);
    this.log(`Subscribed to: ${path}`);
    if (this.isConnected()) {
      this.send({ type: "subscribe", path });
    }
    this.updateSubscriptions();
  }
  /**
   * Unsubscribe from a node path pattern
   */
  unsubscribe(path) {
    this.subscriptions.delete(path);
    this.log(`Unsubscribed from: ${path}`);
    if (this.isConnected()) {
      this.send({ type: "unsubscribe", path });
    }
    this.updateSubscriptions();
  }
  /**
   * Get all active subscriptions
   */
  getSubscriptions() {
    return Array.from(this.subscriptions);
  }
  /**
   * Clear all subscriptions
   */
  clearSubscriptions() {
    const paths = Array.from(this.subscriptions);
    paths.forEach((path) => this.unsubscribe(path));
  }
  // ==========================================
  // Hook Management
  // ==========================================
  /**
   * Add before-update hook
   * Called before a patch is applied
   * Return false to skip the update
   */
  onBeforeUpdate(hook) {
    this.hooks.before.push(hook);
  }
  /**
   * Add update hook
   * Called during patch application
   */
  onUpdate(hook) {
    this.hooks.update.push(hook);
  }
  /**
   * Add after-update hook
   * Called after patch is applied
   */
  onAfterUpdate(hook) {
    this.hooks.after.push(hook);
  }
  /**
   * Clear all hooks
   */
  clearHooks() {
    this.hooks.before = [];
    this.hooks.update = [];
    this.hooks.after = [];
  }
  // ==========================================
  // Patch Processing
  // ==========================================
  /**
   * Handle binary patch from server
   */
  handleBinaryPatch(buffer) {
    try {
      this.stats.bytesReceived += buffer.byteLength;
      const patch = this.decodePatch(buffer);
      this.stats.patchesReceived++;
      this.stats.lastPatchTime = Date.now();
      this.patchQueue.push(patch);
      this.processQueue();
    } catch (error) {
      this.error("Failed to decode patch:", error);
      this.stats.patchesFailed++;
    }
  }
  /**
   * Decode binary patch
   */
  decodePatch(buffer) {
    if (this.options.useMsgpack) {
      const data = new Uint8Array(buffer);
      return import_msgpack_lite.default.decode(data);
    } else {
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text);
    }
  }
  /**
   * Process patch queue
   */
  async processQueue() {
    if (this.processingQueue || this.patchQueue.length === 0) {
      return;
    }
    this.processingQueue = true;
    while (this.patchQueue.length > 0) {
      const patch = this.patchQueue.shift();
      if (patch) {
        this.applyPatch(patch);
      }
    }
    this.processingQueue = false;
  }
  /**
   * Apply patch to FX graph
   */
  applyPatch(patch) {
    const { node_path, field, old_value, new_value } = patch;
    try {
      const shouldContinue = this.runBeforeHooks(node_path, field, old_value, new_value);
      if (!shouldContinue) {
        this.log(`Patch skipped by before hook: ${node_path}.${field}`);
        return;
      }
      const node = this.fx.proxy()(node_path);
      const currentValue = field === "__value" ? node.val() : void 0;
      this.runUpdateHooks(node_path, field, currentValue, new_value);
      if (field === "__value") {
        node.val(new_value);
      } else if (field.startsWith("__meta[")) {
        const key = field.match(/__meta\[(.+)\]/)?.[1];
        if (key) {
          const metaNode = this.fx.proxy()(node_path + ".__meta." + key);
          metaNode.val(new_value);
        }
      } else if (field.startsWith("__nodes[")) {
        const key = field.match(/__nodes\[(.+)\]/)?.[1];
        if (key) {
          const childNode = this.fx.proxy()(node_path + "." + key);
          childNode.val(new_value);
        }
      }
      this.runAfterHooks(node_path, field, currentValue, new_value);
      this.stats.patchesApplied++;
      this.log(`Patch applied: ${node_path}.${field}`);
    } catch (error) {
      this.error(`Failed to apply patch to ${node_path}.${field}:`, error);
      this.stats.patchesFailed++;
    }
  }
  /**
   * Run before-update hooks
   * @returns true to continue, false to skip update
   */
  runBeforeHooks(path, field, oldValue, newValue) {
    for (const hook of this.hooks.before) {
      try {
        const result = hook(path, field, oldValue, newValue);
        if (result === false) {
          return false;
        }
      } catch (error) {
        this.error("Before hook error:", error);
      }
    }
    return true;
  }
  /**
   * Run update hooks
   */
  runUpdateHooks(path, field, oldValue, newValue) {
    for (const hook of this.hooks.update) {
      try {
        hook(path, field, oldValue, newValue);
      } catch (error) {
        this.error("Update hook error:", error);
      }
    }
  }
  /**
   * Run after-update hooks
   */
  runAfterHooks(path, field, oldValue, newValue) {
    for (const hook of this.hooks.after) {
      try {
        hook(path, field, oldValue, newValue);
      } catch (error) {
        this.error("After hook error:", error);
      }
    }
  }
  // ==========================================
  // WebSocket Event Handlers
  // ==========================================
  handleOpen() {
    this.log("Connected to relay server");
    this.setState("connected");
    this.reconnectAttempts = 0;
    this.subscriptions.forEach((path) => {
      this.send({ type: "subscribe", path });
    });
  }
  handleMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      this.handleBinaryPatch(event.data);
    } else {
      try {
        const message = JSON.parse(event.data);
        this.handleControlMessage(message);
      } catch (error) {
        this.error("Failed to parse control message:", error);
      }
    }
  }
  handleControlMessage(message) {
    switch (message.type) {
      case "pong":
        this.log("Pong received");
        break;
      case "error":
        this.error("Server error:", message.message);
        break;
      case "patch":
        if (message.payload) {
          this.handleBinaryPatch(message.payload);
        }
        break;
    }
  }
  handleError(error) {
    this.error("WebSocket error:", error);
    this.setState("error");
  }
  handleClose(event) {
    this.log(`Connection closed: ${event.code} ${event.reason}`);
    this.setState("disconnected");
    this.ws = null;
    if (this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }
  // ==========================================
  // Reconnection Logic
  // ==========================================
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }
    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.log(`Max reconnect attempts (${maxAttempts}) reached`);
      return;
    }
    this.reconnectAttempts++;
    this.setState("reconnecting");
    const delay = this.options.reconnectDelay * Math.min(this.reconnectAttempts, 10);
    this.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
  // ==========================================
  // State Management
  // ==========================================
  setState(state) {
    this.state = state;
    this.fx.proxy()("relay.state").val(state);
  }
  initializeStats() {
    const relay = this.fx.proxy()("relay");
    relay("state").val(this.state);
    relay("subscriptions").val([]);
    relay("stats.patchesReceived").val(0);
    relay("stats.patchesApplied").val(0);
    relay("stats.patchesFailed").val(0);
    relay("stats.bytesReceived").val(0);
    relay("stats.lastPatchTime").val(0);
  }
  updateStats() {
    const stats = this.fx.proxy()("relay.stats");
    stats("patchesReceived").val(this.stats.patchesReceived);
    stats("patchesApplied").val(this.stats.patchesApplied);
    stats("patchesFailed").val(this.stats.patchesFailed);
    stats("bytesReceived").val(this.stats.bytesReceived);
    stats("lastPatchTime").val(this.stats.lastPatchTime);
  }
  updateSubscriptions() {
    this.fx.proxy()("relay.subscriptions").val(Array.from(this.subscriptions));
  }
  // ==========================================
  // Utilities
  // ==========================================
  /**
   * Send message to server
   */
  send(message) {
    if (!this.isConnected()) {
      this.error("Cannot send message: not connected");
      return;
    }
    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      this.error("Failed to send message:", error);
    }
  }
  /**
   * Send ping to server
   */
  ping() {
    this.send({ type: "ping" });
  }
  /**
   * Get relay statistics
   */
  getStats() {
    return { ...this.stats, state: this.state };
  }
  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      patchesReceived: 0,
      patchesApplied: 0,
      patchesFailed: 0,
      bytesReceived: 0,
      lastPatchTime: 0
    };
    this.updateStats();
  }
  log(...args) {
    if (this.options.debug) {
      console.log("[FX Relay]", ...args);
    }
  }
  error(...args) {
    console.error("[FX Relay]", ...args);
  }
  // ==========================================
  // Public API
  // ==========================================
  /**
   * Get current connection URL
   */
  getUrl() {
    return this.options.url;
  }
  /**
   * Set connection URL
   */
  setUrl(url) {
    this.options.url = url;
  }
  /**
   * Get plugin options
   */
  getOptions() {
    return { ...this.options };
  }
}
var stdin_default = FXRelayPlugin;
