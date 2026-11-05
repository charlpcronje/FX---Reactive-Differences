/**
 * FX Flow Worker Adapter
 * Executes flow nodes in Web Workers for isolation and parallelism
 *
 * Features:
 * - Worker pool management
 * - Structured cloning for data transfer
 * - Async operation support with FX_SUSPEND
 * - Error boundary isolation
 * - Resource management
 *
 * @version 1.0.0
 */

import type { FXCore, FXNodeProxy } from '../fx.v4';

interface FlowNode {
  id: string;
  type: string;
  code?: string;
  config?: any;
  inputs?: string[];
  outputs?: string[];
  position?: { x: number; y: number };
}

interface FlowContext {
  variables: Map<string, any>;
  inputs: Map<string, any>;
  outputs: Map<string, any>;
  state: Map<string, any>;
  metadata: {
    flowId: string;
    nodeId: string;
    timestamp: number;
    iteration?: number;
  };
}

interface WorkerMessage {
  type: 'EXECUTE' | 'RESULT' | 'ERROR' | 'SUSPEND' | 'RESUME' | 'LOG';
  id: string;
  data?: any;
  error?: any;
}

interface WorkerExecutionRequest {
  node: FlowNode;
  context: any;
  imports?: Record<string, string>;
}

/**
 * Worker script that will be injected into Web Workers
 */
const WORKER_SCRIPT = `
// Flow Worker Execution Environment
self.FX_SUSPEND = Symbol('FX_SUSPEND');
self.FX_RESUME = Symbol('FX_RESUME');

// Current execution context
let currentContext = null;
let suspendedState = null;

// Import cache
const moduleCache = new Map();

// Custom console for logging
const workerConsole = {
  log: (...args) => {
    self.postMessage({
      type: 'LOG',
      data: { level: 'log', args: args.map(a => serializeValue(a)) }
    });
    console.log(...args);
  },
  error: (...args) => {
    self.postMessage({
      type: 'LOG',
      data: { level: 'error', args: args.map(a => serializeValue(a)) }
    });
    console.error(...args);
  },
  warn: (...args) => {
    self.postMessage({
      type: 'LOG',
      data: { level: 'warn', args: args.map(a => serializeValue(a)) }
    });
    console.warn(...args);
  },
  info: (...args) => {
    self.postMessage({
      type: 'LOG',
      data: { level: 'info', args: args.map(a => serializeValue(a)) }
    });
    console.info(...args);
  }
};

// Serialize value for transfer
function serializeValue(value) {
  try {
    // Handle special types
    if (value === undefined) return { __type: 'undefined' };
    if (value instanceof Error) {
      return {
        __type: 'error',
        message: value.message,
        stack: value.stack,
        name: value.name
      };
    }
    if (value instanceof Date) {
      return { __type: 'date', value: value.toISOString() };
    }
    if (value instanceof RegExp) {
      return { __type: 'regexp', source: value.source, flags: value.flags };
    }
    if (typeof value === 'function') {
      return { __type: 'function', string: value.toString() };
    }
    if (value === FX_SUSPEND) {
      return { __type: 'FX_SUSPEND' };
    }

    // Try structured clone
    try {
      structuredClone(value);
      return value;
    } catch {
      // Fall back to JSON serialization
      return JSON.parse(JSON.stringify(value));
    }
  } catch (error) {
    return { __type: 'error', message: 'Serialization failed: ' + error.message };
  }
}

// Deserialize value from transfer
function deserializeValue(value) {
  if (!value || typeof value !== 'object') return value;

  if (value.__type) {
    switch (value.__type) {
      case 'undefined':
        return undefined;
      case 'error':
        const error = new Error(value.message);
        error.name = value.name;
        error.stack = value.stack;
        return error;
      case 'date':
        return new Date(value.value);
      case 'regexp':
        return new RegExp(value.source, value.flags);
      case 'function':
        try {
          return eval('(' + value.string + ')');
        } catch {
          return () => { throw new Error('Function deserialization failed'); };
        }
      case 'FX_SUSPEND':
        return FX_SUSPEND;
      default:
        return value;
    }
  }

  // Recursively deserialize objects and arrays
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }

  if (value.constructor === Object) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deserializeValue(val);
    }
    return result;
  }

  return value;
}

// Dynamic import with caching
async function dynamicImport(url) {
  if (moduleCache.has(url)) {
    return moduleCache.get(url);
  }

  try {
    const module = await import(url);
    moduleCache.set(url, module);
    return module;
  } catch (error) {
    throw new Error(\`Failed to import module: \${url} - \${error.message}\`);
  }
}

// Execute node code
async function executeNode(node, context, imports = {}) {
  // Prepare execution environment
  const env = {
    // Context variables
    ...context.variables,
    inputs: context.inputs,
    outputs: context.outputs,
    state: context.state,

    // Utilities
    console: workerConsole,
    FX_SUSPEND,
    FX_RESUME,

    // Import function
    require: async (module) => {
      if (imports[module]) {
        return await dynamicImport(imports[module]);
      }
      throw new Error(\`Module not found: \${module}\`);
    },

    // Flow control
    suspend: (state) => {
      suspendedState = state;
      return FX_SUSPEND;
    },

    resume: () => {
      const state = suspendedState;
      suspendedState = null;
      return state;
    },

    // Node metadata
    nodeId: node.id,
    nodeType: node.type,
    flowId: context.metadata?.flowId,
  };

  // Create execution function
  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const argNames = Object.keys(env);
  const argValues = Object.values(env);

  let code = node.code || '';

  // Wrap code to catch errors and handle suspend
  code = \`
    try {
      \${code}
    } catch (error) {
      if (error === FX_SUSPEND) {
        return FX_SUSPEND;
      }
      throw error;
    }
  \`;

  const fn = new AsyncFunction(...argNames, code);

  // Execute with timeout
  const timeout = node.config?.timeout || 30000; // 30 seconds default
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Execution timeout')), timeout);
  });

  try {
    const result = await Promise.race([
      fn(...argValues),
      timeoutPromise
    ]);

    return result;
  } catch (error) {
    throw error;
  }
}

// Message handler
self.addEventListener('message', async (event) => {
  const message = event.data;

  switch (message.type) {
    case 'EXECUTE':
      try {
        const { node, context, imports } = message.data;

        // Deserialize context
        const deserializedContext = {
          variables: deserializeValue(context.variables || {}),
          inputs: deserializeValue(context.inputs || {}),
          outputs: deserializeValue(context.outputs || {}),
          state: deserializeValue(context.state || {}),
          metadata: context.metadata
        };

        currentContext = deserializedContext;

        // Execute node
        const result = await executeNode(node, deserializedContext, imports);

        // Handle suspension
        if (result === FX_SUSPEND) {
          self.postMessage({
            type: 'SUSPEND',
            id: message.id,
            data: {
              state: serializeValue(suspendedState),
              context: serializeValue(deserializedContext)
            }
          });
          return;
        }

        // Send result
        self.postMessage({
          type: 'RESULT',
          id: message.id,
          data: {
            result: serializeValue(result),
            context: serializeValue(deserializedContext)
          }
        });

      } catch (error) {
        self.postMessage({
          type: 'ERROR',
          id: message.id,
          error: serializeValue(error)
        });
      }
      break;

    case 'RESUME':
      try {
        if (!currentContext) {
          throw new Error('No suspended context to resume');
        }

        const result = suspendedState;
        suspendedState = null;

        self.postMessage({
          type: 'RESULT',
          id: message.id,
          data: {
            result: serializeValue(result),
            context: serializeValue(currentContext)
          }
        });

      } catch (error) {
        self.postMessage({
          type: 'ERROR',
          id: message.id,
          error: serializeValue(error)
        });
      }
      break;

    default:
      self.postMessage({
        type: 'ERROR',
        id: message.id,
        error: { message: 'Unknown message type: ' + message.type }
      });
  }
});

// Ready signal
self.postMessage({ type: 'READY' });
`;

/**
 * Worker instance wrapper
 */
class FlowWorker {
  private worker: Worker;
  private busy = false;
  private currentJob: string | null = null;
  private messageQueue: WorkerMessage[] = [];
  private responseCallbacks = new Map<string, { resolve: Function; reject: Function }>();

  constructor(private id: string) {
    // Create worker from blob URL
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);

    // Setup message handler
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }

  private handleMessage(event: MessageEvent): void {
    const message: WorkerMessage = event.data;

    switch (message.type) {
      case 'READY':
        console.log(`[FlowWorker ${this.id}] Ready`);
        break;

      case 'RESULT':
      case 'ERROR':
      case 'SUSPEND':
        const callback = this.responseCallbacks.get(message.id);
        if (callback) {
          if (message.type === 'ERROR') {
            callback.reject(message.error);
          } else {
            callback.resolve(message);
          }
          this.responseCallbacks.delete(message.id);
          this.busy = false;
          this.currentJob = null;
        }
        break;

      case 'LOG':
        // Forward log messages
        const { level, args } = message.data;
        console[level](`[Worker ${this.id}]`, ...args);
        break;
    }
  }

  private handleError(error: ErrorEvent): void {
    console.error(`[FlowWorker ${this.id}] Error:`, error);

    // Reject current job if any
    if (this.currentJob) {
      const callback = this.responseCallbacks.get(this.currentJob);
      if (callback) {
        callback.reject(error);
        this.responseCallbacks.delete(this.currentJob);
      }
      this.busy = false;
      this.currentJob = null;
    }
  }

  async execute(request: WorkerExecutionRequest): Promise<any> {
    if (this.busy) {
      throw new Error(`Worker ${this.id} is busy`);
    }

    this.busy = true;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.currentJob = jobId;

    return new Promise((resolve, reject) => {
      this.responseCallbacks.set(jobId, { resolve, reject });

      this.worker.postMessage({
        type: 'EXECUTE',
        id: jobId,
        data: request,
      });
    });
  }

  isBusy(): boolean {
    return this.busy;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

/**
 * Worker pool manager
 */
export class WorkerFlowExecutor {
  private workers: FlowWorker[] = [];
  private maxWorkers: number;
  private jobQueue: Array<{
    request: WorkerExecutionRequest;
    resolve: Function;
    reject: Function;
  }> = [];
  private logHandlers: Set<Function> = new Set();

  constructor(maxWorkers = navigator.hardwareConcurrency || 4) {
    this.maxWorkers = maxWorkers;
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    // Create initial pool of workers
    const initialWorkers = Math.min(2, this.maxWorkers);
    for (let i = 0; i < initialWorkers; i++) {
      this.createWorker();
    }
  }

  private createWorker(): FlowWorker {
    const workerId = `worker-${this.workers.length}`;
    const worker = new FlowWorker(workerId);
    this.workers.push(worker);
    return worker;
  }

  private getAvailableWorker(): FlowWorker | null {
    // Find idle worker
    for (const worker of this.workers) {
      if (!worker.isBusy()) {
        return worker;
      }
    }

    // Create new worker if under limit
    if (this.workers.length < this.maxWorkers) {
      return this.createWorker();
    }

    return null;
  }

  /**
   * Execute flow node in worker
   */
  async executeNode(node: FlowNode, context: FlowContext): Promise<any> {
    // Prepare execution request
    const request: WorkerExecutionRequest = {
      node,
      context: this.serializeContext(context),
      imports: this.prepareImports(node),
    };

    // Try to get available worker
    const worker = this.getAvailableWorker();

    if (worker) {
      // Execute immediately
      return this.executeWithWorker(worker, request);
    } else {
      // Queue for later execution
      return new Promise((resolve, reject) => {
        this.jobQueue.push({ request, resolve, reject });
        this.processQueue();
      });
    }
  }

  private async executeWithWorker(worker: FlowWorker, request: WorkerExecutionRequest): Promise<any> {
    try {
      const response = await worker.execute(request);

      // Process queue after completion
      this.processQueue();

      // Handle different response types
      switch (response.type) {
        case 'RESULT':
          return this.deserializeValue(response.data.result);

        case 'SUSPEND':
          return {
            suspended: true,
            state: this.deserializeValue(response.data.state),
            context: this.deserializeValue(response.data.context),
          };

        default:
          throw new Error(`Unexpected response type: ${response.type}`);
      }

    } catch (error) {
      // Process queue even on error
      this.processQueue();
      throw error;
    }
  }

  private processQueue(): void {
    if (this.jobQueue.length === 0) return;

    const worker = this.getAvailableWorker();
    if (!worker) return;

    const job = this.jobQueue.shift()!;
    this.executeWithWorker(worker, job.request)
      .then(job.resolve)
      .catch(job.reject);
  }

  /**
   * Serialize context for worker transfer
   */
  private serializeContext(context: FlowContext): any {
    return {
      variables: Object.fromEntries(context.variables),
      inputs: Object.fromEntries(context.inputs),
      outputs: Object.fromEntries(context.outputs),
      state: Object.fromEntries(context.state),
      metadata: context.metadata,
    };
  }

  /**
   * Deserialize value from worker
   */
  private deserializeValue(value: any): any {
    if (!value || typeof value !== 'object') return value;

    if (value.__type) {
      switch (value.__type) {
        case 'undefined':
          return undefined;
        case 'error':
          const error = new Error(value.message);
          error.name = value.name;
          error.stack = value.stack;
          return error;
        case 'date':
          return new Date(value.value);
        case 'regexp':
          return new RegExp(value.source, value.flags);
        case 'function':
          // Don't deserialize functions for security
          return () => { throw new Error('Function execution not allowed'); };
        case 'FX_SUSPEND':
          return Symbol('FX_SUSPEND');
        default:
          return value;
      }
    }

    // Recursively deserialize
    if (Array.isArray(value)) {
      return value.map(v => this.deserializeValue(v));
    }

    if (value.constructor === Object) {
      const result: any = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.deserializeValue(val);
      }
      return result;
    }

    return value;
  }

  /**
   * Prepare module imports for node
   */
  private prepareImports(node: FlowNode): Record<string, string> {
    const imports: Record<string, string> = {};

    // Add common FX modules
    imports['fx'] = '/fx/fx.js';
    imports['fx-flow'] = '/fx/plugins/fx-flow.js';

    // Add node-specific imports from config
    if (node.config?.imports) {
      Object.assign(imports, node.config.imports);
    }

    return imports;
  }

  /**
   * Execute flow graph
   */
  async executeFlow(nodes: FlowNode[], edges: any[], initialContext?: Partial<FlowContext>): Promise<any> {
    const context: FlowContext = {
      variables: new Map(Object.entries(initialContext?.variables || {})),
      inputs: new Map(Object.entries(initialContext?.inputs || {})),
      outputs: new Map(),
      state: new Map(),
      metadata: {
        flowId: `flow-${Date.now()}`,
        nodeId: '',
        timestamp: Date.now(),
      },
    };

    // Build execution order (topological sort)
    const executionOrder = this.topologicalSort(nodes, edges);

    // Execute nodes in order
    const results = new Map<string, any>();

    for (const nodeId of executionOrder) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) continue;

      // Update context metadata
      context.metadata.nodeId = nodeId;
      context.metadata.timestamp = Date.now();

      // Gather inputs from previous nodes
      const nodeInputs = new Map<string, any>();
      const incomingEdges = edges.filter(e => e.target === nodeId);

      for (const edge of incomingEdges) {
        const sourceResult = results.get(edge.source);
        if (sourceResult !== undefined) {
          nodeInputs.set(edge.sourceHandle || 'output', sourceResult);
        }
      }

      // Update context inputs
      context.inputs = nodeInputs;

      try {
        // Execute node
        const result = await this.executeNode(node, context);

        // Handle suspension
        if (result?.suspended) {
          console.log(`[Flow] Node ${nodeId} suspended`);
          return {
            suspended: true,
            nodeId,
            state: result.state,
            context: result.context,
            results: Object.fromEntries(results),
          };
        }

        // Store result
        results.set(nodeId, result);
        context.outputs.set(nodeId, result);

      } catch (error) {
        console.error(`[Flow] Node ${nodeId} failed:`, error);
        throw new Error(`Flow execution failed at node ${nodeId}: ${error.message}`);
      }
    }

    return Object.fromEntries(results);
  }

  /**
   * Topological sort for execution order
   */
  private topologicalSort(nodes: FlowNode[], edges: any[]): string[] {
    const visited = new Set<string>();
    const sorted: string[] = [];

    // Build adjacency list
    const graph = new Map<string, string[]>();
    for (const node of nodes) {
      graph.set(node.id, []);
    }
    for (const edge of edges) {
      const targets = graph.get(edge.source) || [];
      targets.push(edge.target);
      graph.set(edge.source, targets);
    }

    // DFS traversal
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const targets = graph.get(nodeId) || [];
      for (const target of targets) {
        visit(target);
      }

      sorted.unshift(nodeId);
    };

    // Visit all nodes
    for (const node of nodes) {
      visit(node.id);
    }

    return sorted;
  }

  /**
   * Register log handler
   */
  onLog(handler: (level: string, args: any[]) => void): () => void {
    this.logHandlers.add(handler);
    return () => this.logHandlers.delete(handler);
  }

  /**
   * Terminate all workers
   */
  terminate(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.jobQueue = [];
  }

  /**
   * Get pool statistics
   */
  getStats(): any {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter(w => w.isBusy()).length,
      queueLength: this.jobQueue.length,
      maxWorkers: this.maxWorkers,
    };
  }
}

/**
 * Default executor instance
 */
let defaultExecutor: WorkerFlowExecutor | null = null;

/**
 * Get or create default flow executor
 */
export function getFlowExecutor(): WorkerFlowExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new WorkerFlowExecutor();
  }
  return defaultExecutor;
}

/**
 * Create new flow executor
 */
export function createFlowExecutor(maxWorkers?: number): WorkerFlowExecutor {
  return new WorkerFlowExecutor(maxWorkers);
}

export default WorkerFlowExecutor;