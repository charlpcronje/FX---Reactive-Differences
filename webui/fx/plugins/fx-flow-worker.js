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
  WorkerFlowExecutor: () => WorkerFlowExecutor,
  createFlowExecutor: () => createFlowExecutor,
  default: () => stdin_default,
  getFlowExecutor: () => getFlowExecutor
});
module.exports = __toCommonJS(stdin_exports);
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
class FlowWorker {
  constructor(id) {
    this.id = id;
    const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
    const workerUrl = URL.createObjectURL(blob);
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = this.handleMessage.bind(this);
    this.worker.onerror = this.handleError.bind(this);
  }
  worker;
  busy = false;
  currentJob = null;
  messageQueue = [];
  responseCallbacks = /* @__PURE__ */ new Map();
  handleMessage(event) {
    const message = event.data;
    switch (message.type) {
      case "READY":
        console.log(`[FlowWorker ${this.id}] Ready`);
        break;
      case "RESULT":
      case "ERROR":
      case "SUSPEND":
        const callback = this.responseCallbacks.get(message.id);
        if (callback) {
          if (message.type === "ERROR") {
            callback.reject(message.error);
          } else {
            callback.resolve(message);
          }
          this.responseCallbacks.delete(message.id);
          this.busy = false;
          this.currentJob = null;
        }
        break;
      case "LOG":
        const { level, args } = message.data;
        console[level](`[Worker ${this.id}]`, ...args);
        break;
    }
  }
  handleError(error) {
    console.error(`[FlowWorker ${this.id}] Error:`, error);
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
  async execute(request) {
    if (this.busy) {
      throw new Error(`Worker ${this.id} is busy`);
    }
    this.busy = true;
    const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.currentJob = jobId;
    return new Promise((resolve, reject) => {
      this.responseCallbacks.set(jobId, { resolve, reject });
      this.worker.postMessage({
        type: "EXECUTE",
        id: jobId,
        data: request
      });
    });
  }
  isBusy() {
    return this.busy;
  }
  terminate() {
    this.worker.terminate();
  }
}
class WorkerFlowExecutor {
  workers = [];
  maxWorkers;
  jobQueue = [];
  logHandlers = /* @__PURE__ */ new Set();
  constructor(maxWorkers = navigator.hardwareConcurrency || 4) {
    this.maxWorkers = maxWorkers;
    this.initializeWorkers();
  }
  initializeWorkers() {
    const initialWorkers = Math.min(2, this.maxWorkers);
    for (let i = 0; i < initialWorkers; i++) {
      this.createWorker();
    }
  }
  createWorker() {
    const workerId = `worker-${this.workers.length}`;
    const worker = new FlowWorker(workerId);
    this.workers.push(worker);
    return worker;
  }
  getAvailableWorker() {
    for (const worker of this.workers) {
      if (!worker.isBusy()) {
        return worker;
      }
    }
    if (this.workers.length < this.maxWorkers) {
      return this.createWorker();
    }
    return null;
  }
  /**
   * Execute flow node in worker
   */
  async executeNode(node, context) {
    const request = {
      node,
      context: this.serializeContext(context),
      imports: this.prepareImports(node)
    };
    const worker = this.getAvailableWorker();
    if (worker) {
      return this.executeWithWorker(worker, request);
    } else {
      return new Promise((resolve, reject) => {
        this.jobQueue.push({ request, resolve, reject });
        this.processQueue();
      });
    }
  }
  async executeWithWorker(worker, request) {
    try {
      const response = await worker.execute(request);
      this.processQueue();
      switch (response.type) {
        case "RESULT":
          return this.deserializeValue(response.data.result);
        case "SUSPEND":
          return {
            suspended: true,
            state: this.deserializeValue(response.data.state),
            context: this.deserializeValue(response.data.context)
          };
        default:
          throw new Error(`Unexpected response type: ${response.type}`);
      }
    } catch (error) {
      this.processQueue();
      throw error;
    }
  }
  processQueue() {
    if (this.jobQueue.length === 0) return;
    const worker = this.getAvailableWorker();
    if (!worker) return;
    const job = this.jobQueue.shift();
    this.executeWithWorker(worker, job.request).then(job.resolve).catch(job.reject);
  }
  /**
   * Serialize context for worker transfer
   */
  serializeContext(context) {
    return {
      variables: Object.fromEntries(context.variables),
      inputs: Object.fromEntries(context.inputs),
      outputs: Object.fromEntries(context.outputs),
      state: Object.fromEntries(context.state),
      metadata: context.metadata
    };
  }
  /**
   * Deserialize value from worker
   */
  deserializeValue(value) {
    if (!value || typeof value !== "object") return value;
    if (value.__type) {
      switch (value.__type) {
        case "undefined":
          return void 0;
        case "error":
          const error = new Error(value.message);
          error.name = value.name;
          error.stack = value.stack;
          return error;
        case "date":
          return new Date(value.value);
        case "regexp":
          return new RegExp(value.source, value.flags);
        case "function":
          return () => {
            throw new Error("Function execution not allowed");
          };
        case "FX_SUSPEND":
          return Symbol("FX_SUSPEND");
        default:
          return value;
      }
    }
    if (Array.isArray(value)) {
      return value.map((v) => this.deserializeValue(v));
    }
    if (value.constructor === Object) {
      const result = {};
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
  prepareImports(node) {
    const imports = {};
    imports["fx"] = "/fx/fx.js";
    imports["fx-flow"] = "/fx/plugins/fx-flow.js";
    if (node.config?.imports) {
      Object.assign(imports, node.config.imports);
    }
    return imports;
  }
  /**
   * Execute flow graph
   */
  async executeFlow(nodes, edges, initialContext) {
    const context = {
      variables: new Map(Object.entries(initialContext?.variables || {})),
      inputs: new Map(Object.entries(initialContext?.inputs || {})),
      outputs: /* @__PURE__ */ new Map(),
      state: /* @__PURE__ */ new Map(),
      metadata: {
        flowId: `flow-${Date.now()}`,
        nodeId: "",
        timestamp: Date.now()
      }
    };
    const executionOrder = this.topologicalSort(nodes, edges);
    const results = /* @__PURE__ */ new Map();
    for (const nodeId of executionOrder) {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;
      context.metadata.nodeId = nodeId;
      context.metadata.timestamp = Date.now();
      const nodeInputs = /* @__PURE__ */ new Map();
      const incomingEdges = edges.filter((e) => e.target === nodeId);
      for (const edge of incomingEdges) {
        const sourceResult = results.get(edge.source);
        if (sourceResult !== void 0) {
          nodeInputs.set(edge.sourceHandle || "output", sourceResult);
        }
      }
      context.inputs = nodeInputs;
      try {
        const result = await this.executeNode(node, context);
        if (result?.suspended) {
          console.log(`[Flow] Node ${nodeId} suspended`);
          return {
            suspended: true,
            nodeId,
            state: result.state,
            context: result.context,
            results: Object.fromEntries(results)
          };
        }
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
  topologicalSort(nodes, edges) {
    const visited = /* @__PURE__ */ new Set();
    const sorted = [];
    const graph = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      graph.set(node.id, []);
    }
    for (const edge of edges) {
      const targets = graph.get(edge.source) || [];
      targets.push(edge.target);
      graph.set(edge.source, targets);
    }
    const visit = (nodeId) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const targets = graph.get(nodeId) || [];
      for (const target of targets) {
        visit(target);
      }
      sorted.unshift(nodeId);
    };
    for (const node of nodes) {
      visit(node.id);
    }
    return sorted;
  }
  /**
   * Register log handler
   */
  onLog(handler) {
    this.logHandlers.add(handler);
    return () => this.logHandlers.delete(handler);
  }
  /**
   * Terminate all workers
   */
  terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.jobQueue = [];
  }
  /**
   * Get pool statistics
   */
  getStats() {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.isBusy()).length,
      queueLength: this.jobQueue.length,
      maxWorkers: this.maxWorkers
    };
  }
}
let defaultExecutor = null;
function getFlowExecutor() {
  if (!defaultExecutor) {
    defaultExecutor = new WorkerFlowExecutor();
  }
  return defaultExecutor;
}
function createFlowExecutor(maxWorkers) {
  return new WorkerFlowExecutor(maxWorkers);
}
var stdin_default = WorkerFlowExecutor;
