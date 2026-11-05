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
  FXSerializePlugin: () => FXSerializePlugin,
  default: () => stdin_default
});
module.exports = __toCommonJS(stdin_exports);
class SerializationLogger {
  static log(level, message, data = {}) {
    console.log(`[FX-SERIALIZE:${level.toUpperCase()}]`, message, data);
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
}
class FXSerializePlugin {
  fx;
  options;
  classRegistry = /* @__PURE__ */ new Map();
  name = "serialize";
  version = "2.0.0";
  description = "State serialization and deserialization for FX nodes with TypeScript enhancements";
  constructor(fx, options = {}) {
    this.fx = fx;
    this.options = {
      includePrivateProps: false,
      compressOutput: false,
      preserveClassInstances: true,
      maxDepth: 50,
      includeFunctions: false,
      customSerializers: /* @__PURE__ */ new Map(),
      ...options
    };
    SerializationLogger.info("Serialize plugin initialized", {
      preserveClassInstances: this.options.preserveClassInstances,
      maxDepth: this.options.maxDepth
    });
  }
  /**
   * Register a class for serialization/deserialization
   */
  registerClass(constructor, name) {
    const className = name || constructor.name;
    this.classRegistry.set(className, constructor);
    SerializationLogger.info(`Class registered: ${className}`);
    return this;
  }
  /**
   * Register a custom serializer for a specific type
   */
  registerSerializer(typeName, serializer, deserializer) {
    this.options.customSerializers.set(typeName, { serializer, deserializer });
    SerializationLogger.info(`Custom serializer registered: ${typeName}`);
    return this;
  }
  /**
   * Serialize FX state to JSON-safe object
   */
  wrap(startNode = this.fx.root, options = {}) {
    const config = { ...this.options, ...options };
    SerializationLogger.info("Starting serialization", {
      startNodeId: startNode.__id,
      maxDepth: config.maxDepth
    });
    try {
      const result = this.wrapNode(startNode, config, 0, /* @__PURE__ */ new Set());
      const output = {
        __fx_serialized: true,
        __fx_version: this.version,
        __fx_timestamp: Date.now(),
        __fx_root: result
      };
      if (config.compressOutput) {
        output.__fx_compressed = true;
      }
      SerializationLogger.info("Serialization completed", {
        compressed: config.compressOutput,
        nodes: this.countNodes(result)
      });
      return output;
    } catch (error) {
      SerializationLogger.error("Serialization failed", error);
      throw error;
    }
  }
  wrapNode(node, config, depth, visited) {
    if (depth > config.maxDepth) {
      return {
        __id: node.__id,
        __parent_id: node.__parent_id,
        __type: null,
        __proto: [],
        __fx_max_depth_exceeded: true
      };
    }
    if (visited.has(node.__id)) {
      return {
        __id: node.__id,
        __parent_id: node.__parent_id,
        __type: null,
        __proto: [],
        __fx_circular_reference: node.__id
      };
    }
    visited.add(node.__id);
    const output = {
      __id: node.__id,
      __parent_id: node.__parent_id,
      __type: node.__type,
      __proto: [...node.__proto || []]
    };
    if (node.__type && node.__value) {
      if (node.__instances && node.__instances.has(node.__type)) {
        const instance = node.__instances.get(node.__type);
        if (config.preserveClassInstances) {
          output.__instance_data = this.serializeInstance(instance, config);
          output.__instance_class = node.__type;
        } else {
          output.__value = this.instanceToPlainObject(instance);
        }
      } else if (typeof node.__value === "object" && node.__value[node.__type] !== void 0) {
        output.__value = this.serializeValue(node.__value[node.__type], config);
      }
    }
    if (node.__behaviors && node.__behaviors.size > 0) {
      output.__behaviors = Array.from(node.__behaviors.keys());
    }
    if (node.__nodes && Object.keys(node.__nodes).length > 0) {
      output.__nodes = {};
      for (const [key, childNode] of Object.entries(node.__nodes)) {
        if (!config.includePrivateProps && key.startsWith("_")) {
          continue;
        }
        output.__nodes[key] = this.wrapNode(childNode, config, depth + 1, visited);
      }
    }
    if (node.__effects && node.__effects.length > 0) {
      output.__effects_count = node.__effects.length;
      output.__effects_info = node.__effects.map((effect) => ({
        name: effect.name || "anonymous",
        length: effect.length
      }));
    }
    if (node.__watchers && node.__watchers.size > 0) {
      output.__watchers_count = node.__watchers.size;
    }
    visited.delete(node.__id);
    return output;
  }
  serializeInstance(instance, config) {
    const data = {
      __constructor: instance.constructor.name,
      __constructorParams: instance.constructor.length
    };
    const customSerializer = config.customSerializers.get(instance.constructor.name);
    if (customSerializer) {
      return customSerializer.serializer(instance);
    }
    for (const key in instance) {
      if (instance.hasOwnProperty(key)) {
        const value = instance[key];
        if (typeof value === "function") {
          if (config.includeFunctions) {
            data[key] = {
              __fx_function: true,
              name: value.name || "anonymous",
              length: value.length
            };
          }
        } else {
          data[key] = this.serializeValue(value, config);
        }
      }
    }
    return data;
  }
  instanceToPlainObject(instance) {
    const obj = {};
    for (const key in instance) {
      if (instance.hasOwnProperty(key) && typeof instance[key] !== "function") {
        obj[key] = this.serializeValue(instance[key], this.options);
      }
    }
    return obj;
  }
  serializeValue(value, config) {
    if (value === null || value === void 0) {
      return value;
    }
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") {
      return value;
    }
    if (type === "function") {
      if (config.includeFunctions) {
        return {
          __fx_function: true,
          name: value.name || "anonymous",
          length: value.length,
          source: value.toString().slice(0, 200)
          // First 200 chars
        };
      }
      return void 0;
    }
    if (value instanceof Date) {
      return {
        __fx_date: true,
        value: value.toISOString()
      };
    }
    if (value instanceof RegExp) {
      return {
        __fx_regexp: true,
        source: value.source,
        flags: value.flags
      };
    }
    if (value instanceof Set) {
      return {
        __fx_set: true,
        values: Array.from(value).map((v) => this.serializeValue(v, config))
      };
    }
    if (value instanceof Map) {
      return {
        __fx_map: true,
        entries: Array.from(value.entries()).map(([k, v]) => [
          this.serializeValue(k, config),
          this.serializeValue(v, config)
        ])
      };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item, config));
    }
    if (type === "object") {
      const obj = {};
      for (const [key, val] of Object.entries(value)) {
        if (!config.includePrivateProps && key.startsWith("_")) {
          continue;
        }
        obj[key] = this.serializeValue(val, config);
      }
      return obj;
    }
    return value;
  }
  /**
   * Deserialize FX state from serialized object
   */
  expand(serializedData, targetNode = this.fx.root, options = {}) {
    const config = { ...this.options, ...options };
    SerializationLogger.info("Starting deserialization", {
      targetNodeId: targetNode.__id,
      preserveInstances: config.preserveClassInstances
    });
    try {
      if (!serializedData.__fx_serialized) {
        throw new Error("Invalid serialized data - missing FX signature");
      }
      if (serializedData.__fx_compressed) {
        throw new Error("Compressed data decompression not yet implemented");
      }
      const result = this.expandNode(serializedData.__fx_root, targetNode, config, /* @__PURE__ */ new Map());
      SerializationLogger.info("Deserialization completed");
      return result;
    } catch (error) {
      SerializationLogger.error("Deserialization failed", error);
      throw error;
    }
  }
  expandNode(serializedNode, targetNode, config, idMap) {
    if (serializedNode.__fx_max_depth_exceeded) {
      SerializationLogger.warn("Max depth exceeded during serialization");
      return targetNode;
    }
    if (serializedNode.__fx_circular_reference) {
      const referencedNode = idMap.get(serializedNode.__fx_circular_reference);
      if (referencedNode) {
        return referencedNode;
      } else {
        SerializationLogger.warn("Circular reference not found", serializedNode.__fx_circular_reference);
        return targetNode;
      }
    }
    targetNode.__id = serializedNode.__id;
    targetNode.__parent_id = serializedNode.__parent_id;
    targetNode.__type = serializedNode.__type;
    targetNode.__proto = [...serializedNode.__proto || []];
    idMap.set(targetNode.__id, targetNode);
    if (serializedNode.__instance_data && serializedNode.__instance_class) {
      if (config.preserveClassInstances) {
        this.restoreInstance(targetNode, serializedNode.__instance_class, serializedNode.__instance_data, config);
      } else {
        targetNode.__type = "object";
        if (!targetNode.__value || typeof targetNode.__value !== "object") {
          targetNode.__value = {};
        }
        targetNode.__value.object = this.deserializeValue(serializedNode.__instance_data, config);
      }
    } else if (serializedNode.__value !== void 0) {
      const deserializedValue = this.deserializeValue(serializedNode.__value, config);
      if (!targetNode.__value || typeof targetNode.__value !== "object") {
        targetNode.__value = {};
      }
      if (targetNode.__type) {
        targetNode.__value[targetNode.__type] = deserializedValue;
      }
    }
    if (serializedNode.__behaviors) {
      if (!targetNode.__behaviors) {
        targetNode.__behaviors = /* @__PURE__ */ new Map();
      }
      serializedNode.__behaviors.forEach((behaviorName) => {
        SerializationLogger.warn(`Behavior ${behaviorName} needs manual restoration`);
      });
    }
    if (serializedNode.__nodes) {
      if (!targetNode.__nodes) {
        targetNode.__nodes = /* @__PURE__ */ Object.create(null);
      }
      for (const [key, childData] of Object.entries(serializedNode.__nodes)) {
        if (!targetNode.__nodes[key]) {
          targetNode.__nodes[key] = this.fx.createNode(targetNode.__id);
        }
        this.expandNode(childData, targetNode.__nodes[key], config, idMap);
      }
    }
    if (serializedNode.__effects_count) {
      SerializationLogger.warn(`Node had ${serializedNode.__effects_count} effects (manual restoration required)`);
    }
    if (serializedNode.__watchers_count) {
      SerializationLogger.warn(`Node had ${serializedNode.__watchers_count} watchers (manual restoration required)`);
    }
    return targetNode;
  }
  restoreInstance(node, className, instanceData, config) {
    const customSerializer = config.customSerializers.get(className);
    if (customSerializer && customSerializer.deserializer) {
      try {
        const restored = customSerializer.deserializer(instanceData);
        if (!node.__instances) {
          node.__instances = /* @__PURE__ */ new Map();
        }
        node.__instances.set(className, restored);
        SerializationLogger.info(`Restored ${className} instance using custom deserializer`);
        return;
      } catch (error) {
        SerializationLogger.warn(`Custom deserializer failed for ${className}`, error);
      }
    }
    const RegisteredClass = this.classRegistry.get(className);
    if (!RegisteredClass) {
      SerializationLogger.warn(`Class ${className} not registered, storing as plain object`);
      node.__type = "object";
      if (!node.__value || typeof node.__value !== "object") {
        node.__value = {};
      }
      node.__value.object = this.deserializeValue(instanceData, config);
      return;
    }
    try {
      const instance = new RegisteredClass();
      for (const [key, value] of Object.entries(instanceData)) {
        if (!key.startsWith("__") && key !== "__constructor" && key !== "__constructorParams") {
          instance[key] = this.deserializeValue(value, config);
        }
      }
      if (!node.__instances) {
        node.__instances = /* @__PURE__ */ new Map();
      }
      node.__instances.set(className, instance);
      SerializationLogger.info(`Restored ${className} instance`);
    } catch (error) {
      SerializationLogger.error(`Failed to restore ${className} instance`, error);
      node.__type = "object";
      if (!node.__value || typeof node.__value !== "object") {
        node.__value = {};
      }
      node.__value.object = this.deserializeValue(instanceData, config);
    }
  }
  deserializeValue(value, config) {
    if (value === null || value === void 0) {
      return value;
    }
    if (typeof value !== "object") {
      return value;
    }
    if (value.__fx_function) {
      const placeholder = function(...args) {
        throw new Error(`Serialized function '${value.name}' cannot be executed. Original source: ${value.source || "unknown"}`);
      };
      Object.defineProperty(placeholder, "name", { value: value.name || "serialized_function" });
      return placeholder;
    }
    if (value.__fx_date) {
      return new Date(value.value);
    }
    if (value.__fx_regexp) {
      return new RegExp(value.source, value.flags);
    }
    if (value.__fx_set) {
      return new Set(value.values.map((v) => this.deserializeValue(v, config)));
    }
    if (value.__fx_map) {
      const map = /* @__PURE__ */ new Map();
      for (const [k, v] of value.entries) {
        map.set(
          this.deserializeValue(k, config),
          this.deserializeValue(v, config)
        );
      }
      return map;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.deserializeValue(item, config));
    }
    const obj = {};
    for (const [key, val] of Object.entries(value)) {
      obj[key] = this.deserializeValue(val, config);
    }
    return obj;
  }
  /**
   * Serialize only specific paths
   */
  wrapPartial(paths, options = {}) {
    const config = { ...this.options, ...options };
    const result = {
      __fx_serialized: true,
      __fx_version: this.version,
      __fx_timestamp: Date.now(),
      __fx_partial: true,
      __fx_paths: {},
      __fx_root: {}
    };
    SerializationLogger.info("Starting partial serialization", { paths });
    for (const path of paths) {
      const node = this.fx.resolvePath(path, this.fx.root);
      if (node) {
        result.__fx_paths[path] = this.wrapNode(node, config, 0, /* @__PURE__ */ new Set());
      } else {
        SerializationLogger.warn(`Path not found during partial serialization: ${path}`);
      }
    }
    SerializationLogger.info("Partial serialization completed", {
      pathCount: Object.keys(result.__fx_paths || {}).length
    });
    return result;
  }
  /**
   * Compare two serialized states
   */
  compare(stateA, stateB) {
    const differences = [];
    if (stateA.__fx_partial || stateB.__fx_partial) {
      throw new Error("Cannot compare partial states");
    }
    this.compareNodes(stateA.__fx_root, stateB.__fx_root, "root", differences);
    return differences;
  }
  compareNodes(nodeA, nodeB, path, differences) {
    if (JSON.stringify(nodeA.__value) !== JSON.stringify(nodeB.__value)) {
      differences.push({ path, a: nodeA.__value, b: nodeB.__value });
    }
    if (nodeA.__type !== nodeB.__type) {
      differences.push({ path: `${path}.__type`, a: nodeA.__type, b: nodeB.__type });
    }
    const allChildKeys = /* @__PURE__ */ new Set([
      ...Object.keys(nodeA.__nodes || {}),
      ...Object.keys(nodeB.__nodes || {})
    ]);
    for (const childKey of allChildKeys) {
      const childA = nodeA.__nodes?.[childKey];
      const childB = nodeB.__nodes?.[childKey];
      const childPath = path === "root" ? childKey : `${path}.${childKey}`;
      if (childA && childB) {
        this.compareNodes(childA, childB, childPath, differences);
      } else if (childA && !childB) {
        differences.push({ path: childPath, a: "[exists]", b: "[missing]" });
      } else if (!childA && childB) {
        differences.push({ path: childPath, a: "[missing]", b: "[exists]" });
      }
    }
  }
  /**
   * Create a compressed version of serialized data
   */
  async compress(serializedData) {
    const jsonString = JSON.stringify(serializedData);
    const compressed = {
      ...serializedData,
      __fx_compressed: true,
      __fx_compressed_size: jsonString.length,
      __fx_original_size: jsonString.length
    };
    SerializationLogger.info("Compression completed", {
      originalSize: jsonString.length,
      compressedSize: jsonString.length
      // Would be smaller with real compression
    });
    return compressed;
  }
  countNodes(node) {
    let count = 1;
    if (node.__nodes) {
      for (const child of Object.values(node.__nodes)) {
        count += this.countNodes(child);
      }
    }
    return count;
  }
  /**
   * Get serialization plugin statistics
   */
  getStats() {
    return {
      registeredClasses: Array.from(this.classRegistry.keys()),
      customSerializers: Array.from(this.options.customSerializers.keys()),
      options: {
        includePrivateProps: this.options.includePrivateProps,
        compressOutput: this.options.compressOutput,
        preserveClassInstances: this.options.preserveClassInstances,
        maxDepth: this.options.maxDepth,
        includeFunctions: this.options.includeFunctions
      }
    };
  }
}
function stdin_default(fx, options) {
  return new FXSerializePlugin(fx, options);
}
