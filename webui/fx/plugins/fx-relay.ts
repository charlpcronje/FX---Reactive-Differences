/**
 * @file fx-relay.ts
 * @fx-plugin fx-relay
 * @fx-global $relay
 * @fx-description Binary delta patch relay client for distributed FX graphs
 * @fx-version 1.0.0
 *
 * FX Relay Plugin - WebSocket client for receiving binary delta patches
 *
 * Features:
 * - Binary delta streaming via WebSocket (bincode/MessagePack)
 * - Patch subscription model (clients choose what to observe)
 * - BeforeUpdate / Update / AfterUpdate hooks
 * - Zero-copy pass-through for Native & NodeRef values
 * - Guaranteed ordering of patches
 * - Cross-language compatibility with Rust FX Relay server
 *
 * Architecture:
 *   Rust FX Relay Server (port 9876)
 *   ↓ (binary delta patches)
 *   TypeScript FX Relay Client (this plugin)
 *   ↓ (applies to local FX graph)
 *   Local FX nodes updated
 */

import type { FXCore as FX, FXNode, FXNodeProxy } from "../fx.v4";
import msgpack from "msgpack-lite";

// ==========================================
// Types
// ==========================================

export type FXN = FXNodeProxy<any, any>;

/**
 * Binary delta patch message
 */
export interface FXDeltaPatch {
  /** Timestamp in nanoseconds */
  timestamp_ns: number;

  /** Node path (e.g., "rfs.certainty.core") */
  node_path: string;

  /** Field being updated ("__value", "__meta[key]", etc.) */
  field: string;

  /** New value after update */
  new_value: any;

  /** Old value before update (optional) */
  old_value?: any;

  /** Event type */
  event_type: string;
}

/**
 * Client subscription message
 */
export type ClientMessage =
  | { type: 'subscribe'; path: string }
  | { type: 'unsubscribe'; path: string }
  | { type: 'ping' };

/**
 * Server message to client
 */
export type ServerMessage =
  | { type: 'patch'; payload: ArrayBuffer }
  | { type: 'pong' }
  | { type: 'error'; message: string };

/**
 * Hook function types
 */
export type BeforeUpdateHook = (
  path: string,
  field: string,
  oldValue: any,
  newValue: any
) => void | boolean; // return false to skip update

export type UpdateHook = (
  path: string,
  field: string,
  oldValue: any,
  newValue: any
) => void;

export type AfterUpdateHook = (
  path: string,
  field: string,
  oldValue: any,
  newValue: any
) => void;

/**
 * Hook registry
 */
export interface RelayHooks {
  before: BeforeUpdateHook[];
  update: UpdateHook[];
  after: AfterUpdateHook[];
}

/**
 * Connection state
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

/**
 * Relay plugin options
 */
export interface FXRelayOptions {
  /** WebSocket URL (default: ws://127.0.0.1:9876) */
  url?: string;

  /** Auto-connect on initialization */
  autoConnect?: boolean;

  /** Auto-reconnect on disconnect */
  autoReconnect?: boolean;

  /** Reconnect delay in ms */
  reconnectDelay?: number;

  /** Max reconnect attempts (0 = infinite) */
  maxReconnectAttempts?: number;

  /** Enable verbose logging */
  debug?: boolean;

  /** Use MessagePack encoding (default: true) */
  useMsgpack?: boolean;
}

// ==========================================
// FX Relay Plugin
// ==========================================

/**
 * FX Relay Plugin - Binary delta patch relay client
 */
export class FXRelayPlugin {
  public readonly name = 'relay';
  public readonly version = '1.0.0';
  public readonly description = 'Binary delta patch relay client';

  private fx: FX;
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private hooks: RelayHooks;
  private options: Required<FXRelayOptions>;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private patchQueue: FXDeltaPatch[] = [];
  private processingQueue = false;

  // Stats tracking
  private stats = {
    patchesReceived: 0,
    patchesApplied: 0,
    patchesFailed: 0,
    bytesReceived: 0,
    lastPatchTime: 0,
  };

  constructor(fx: FX, options: FXRelayOptions = {}) {
    this.fx = fx;
    this.options = {
      url: options.url || 'ws://127.0.0.1:9876',
      autoConnect: options.autoConnect !== false,
      autoReconnect: options.autoReconnect !== false,
      reconnectDelay: options.reconnectDelay || 1000,
      maxReconnectAttempts: options.maxReconnectAttempts || 0,
      debug: options.debug || false,
      useMsgpack: options.useMsgpack !== false,
    };

    this.hooks = {
      before: [],
      update: [],
      after: [],
    };

    // Initialize relay stats in FX graph
    this.initializeStats();

    // Auto-connect if enabled
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
  connect(url?: string): void {
    if (this.ws && this.state === 'connected') {
      this.log('Already connected');
      return;
    }

    const wsUrl = url || this.options.url;
    this.log(`Connecting to ${wsUrl}`);
    this.setState('connecting');

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onerror = (error) => this.handleError(error);
      this.ws.onclose = (event) => this.handleClose(event);

    } catch (error) {
      this.error('Connection failed:', error);
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setState('disconnected');
    this.log('Disconnected');
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
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
  subscribe(path: string): void {
    this.subscriptions.add(path);
    this.log(`Subscribed to: ${path}`);

    // Send to server if connected
    if (this.isConnected()) {
      this.send({ type: 'subscribe', path });
    }

    // Update FX stats
    this.updateSubscriptions();
  }

  /**
   * Unsubscribe from a node path pattern
   */
  unsubscribe(path: string): void {
    this.subscriptions.delete(path);
    this.log(`Unsubscribed from: ${path}`);

    // Send to server if connected
    if (this.isConnected()) {
      this.send({ type: 'unsubscribe', path });
    }

    // Update FX stats
    this.updateSubscriptions();
  }

  /**
   * Get all active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Clear all subscriptions
   */
  clearSubscriptions(): void {
    const paths = Array.from(this.subscriptions);
    paths.forEach(path => this.unsubscribe(path));
  }

  // ==========================================
  // Hook Management
  // ==========================================

  /**
   * Add before-update hook
   * Called before a patch is applied
   * Return false to skip the update
   */
  onBeforeUpdate(hook: BeforeUpdateHook): void {
    this.hooks.before.push(hook);
  }

  /**
   * Add update hook
   * Called during patch application
   */
  onUpdate(hook: UpdateHook): void {
    this.hooks.update.push(hook);
  }

  /**
   * Add after-update hook
   * Called after patch is applied
   */
  onAfterUpdate(hook: AfterUpdateHook): void {
    this.hooks.after.push(hook);
  }

  /**
   * Clear all hooks
   */
  clearHooks(): void {
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
  private handleBinaryPatch(buffer: ArrayBuffer): void {
    try {
      this.stats.bytesReceived += buffer.byteLength;

      // Decode patch
      const patch = this.decodePatch(buffer);

      this.stats.patchesReceived++;
      this.stats.lastPatchTime = Date.now();

      // Queue patch for processing
      this.patchQueue.push(patch);
      this.processQueue();

    } catch (error) {
      this.error('Failed to decode patch:', error);
      this.stats.patchesFailed++;
    }
  }

  /**
   * Decode binary patch
   */
  private decodePatch(buffer: ArrayBuffer): FXDeltaPatch {
    if (this.options.useMsgpack) {
      // Decode using MessagePack
      const data = new Uint8Array(buffer);
      return msgpack.decode(data) as FXDeltaPatch;
    } else {
      // Fallback to JSON (for debugging)
      const text = new TextDecoder().decode(buffer);
      return JSON.parse(text) as FXDeltaPatch;
    }
  }

  /**
   * Process patch queue
   */
  private async processQueue(): Promise<void> {
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
  private applyPatch(patch: FXDeltaPatch): void {
    const { node_path, field, old_value, new_value } = patch;

    try {
      // Run before hooks
      const shouldContinue = this.runBeforeHooks(node_path, field, old_value, new_value);
      if (!shouldContinue) {
        this.log(`Patch skipped by before hook: ${node_path}.${field}`);
        return;
      }

      // Get current value
      const node = this.fx.proxy()(node_path);
      const currentValue = field === '__value' ? node.val() : undefined;

      // Run update hooks
      this.runUpdateHooks(node_path, field, currentValue, new_value);

      // Apply to FX tree
      if (field === '__value') {
        // Update node value
        node.val(new_value);
      } else if (field.startsWith('__meta[')) {
        // Update metadata
        const key = field.match(/__meta\[(.+)\]/)?.[1];
        if (key) {
          const metaNode = this.fx.proxy()(node_path + '.__meta.' + key);
          metaNode.val(new_value);
        }
      } else if (field.startsWith('__nodes[')) {
        // Update child node
        const key = field.match(/__nodes\[(.+)\]/)?.[1];
        if (key) {
          const childNode = this.fx.proxy()(node_path + '.' + key);
          childNode.val(new_value);
        }
      }

      // Run after hooks
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
  private runBeforeHooks(path: string, field: string, oldValue: any, newValue: any): boolean {
    for (const hook of this.hooks.before) {
      try {
        const result = hook(path, field, oldValue, newValue);
        if (result === false) {
          return false;
        }
      } catch (error) {
        this.error('Before hook error:', error);
      }
    }
    return true;
  }

  /**
   * Run update hooks
   */
  private runUpdateHooks(path: string, field: string, oldValue: any, newValue: any): void {
    for (const hook of this.hooks.update) {
      try {
        hook(path, field, oldValue, newValue);
      } catch (error) {
        this.error('Update hook error:', error);
      }
    }
  }

  /**
   * Run after-update hooks
   */
  private runAfterHooks(path: string, field: string, oldValue: any, newValue: any): void {
    for (const hook of this.hooks.after) {
      try {
        hook(path, field, oldValue, newValue);
      } catch (error) {
        this.error('After hook error:', error);
      }
    }
  }

  // ==========================================
  // WebSocket Event Handlers
  // ==========================================

  private handleOpen(): void {
    this.log('Connected to relay server');
    this.setState('connected');
    this.reconnectAttempts = 0;

    // Re-subscribe to all paths
    this.subscriptions.forEach(path => {
      this.send({ type: 'subscribe', path });
    });
  }

  private handleMessage(event: MessageEvent): void {
    if (event.data instanceof ArrayBuffer) {
      // Binary patch
      this.handleBinaryPatch(event.data);
    } else {
      // JSON control message
      try {
        const message: ServerMessage = JSON.parse(event.data);
        this.handleControlMessage(message);
      } catch (error) {
        this.error('Failed to parse control message:', error);
      }
    }
  }

  private handleControlMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'pong':
        this.log('Pong received');
        break;

      case 'error':
        this.error('Server error:', message.message);
        break;

      case 'patch':
        // Binary patch in JSON wrapper (fallback)
        if (message.payload) {
          this.handleBinaryPatch(message.payload);
        }
        break;
    }
  }

  private handleError(error: Event): void {
    this.error('WebSocket error:', error);
    this.setState('error');
  }

  private handleClose(event: CloseEvent): void {
    this.log(`Connection closed: ${event.code} ${event.reason}`);
    this.setState('disconnected');
    this.ws = null;

    // Schedule reconnect if enabled
    if (this.options.autoReconnect) {
      this.scheduleReconnect();
    }
  }

  // ==========================================
  // Reconnection Logic
  // ==========================================

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    const maxAttempts = this.options.maxReconnectAttempts;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      this.log(`Max reconnect attempts (${maxAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    this.setState('reconnecting');

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

  private setState(state: ConnectionState): void {
    this.state = state;

    // Update FX graph
    this.fx.proxy()('relay.state').val(state);
  }

  private initializeStats(): void {
    const relay = this.fx.proxy()('relay');

    relay('state').val(this.state);
    relay('subscriptions').val([]);

    relay('stats.patchesReceived').val(0);
    relay('stats.patchesApplied').val(0);
    relay('stats.patchesFailed').val(0);
    relay('stats.bytesReceived').val(0);
    relay('stats.lastPatchTime').val(0);
  }

  private updateStats(): void {
    const stats = this.fx.proxy()('relay.stats');

    stats('patchesReceived').val(this.stats.patchesReceived);
    stats('patchesApplied').val(this.stats.patchesApplied);
    stats('patchesFailed').val(this.stats.patchesFailed);
    stats('bytesReceived').val(this.stats.bytesReceived);
    stats('lastPatchTime').val(this.stats.lastPatchTime);
  }

  private updateSubscriptions(): void {
    this.fx.proxy()('relay.subscriptions').val(Array.from(this.subscriptions));
  }

  // ==========================================
  // Utilities
  // ==========================================

  /**
   * Send message to server
   */
  private send(message: ClientMessage): void {
    if (!this.isConnected()) {
      this.error('Cannot send message: not connected');
      return;
    }

    try {
      this.ws!.send(JSON.stringify(message));
    } catch (error) {
      this.error('Failed to send message:', error);
    }
  }

  /**
   * Send ping to server
   */
  ping(): void {
    this.send({ type: 'ping' });
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
  resetStats(): void {
    this.stats = {
      patchesReceived: 0,
      patchesApplied: 0,
      patchesFailed: 0,
      bytesReceived: 0,
      lastPatchTime: 0,
    };
    this.updateStats();
  }

  private log(...args: any[]): void {
    if (this.options.debug) {
      console.log('[FX Relay]', ...args);
    }
  }

  private error(...args: any[]): void {
    console.error('[FX Relay]', ...args);
  }

  // ==========================================
  // Public API
  // ==========================================

  /**
   * Get current connection URL
   */
  getUrl(): string {
    return this.options.url;
  }

  /**
   * Set connection URL
   */
  setUrl(url: string): void {
    this.options.url = url;
  }

  /**
   * Get plugin options
   */
  getOptions(): Required<FXRelayOptions> {
    return { ...this.options };
  }
}

// ==========================================
// Export
// ==========================================

export default FXRelayPlugin;
