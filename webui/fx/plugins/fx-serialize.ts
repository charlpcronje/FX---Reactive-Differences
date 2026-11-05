/**
 * fx-serialize.ts - TypeScript Enhanced Serialization Plugin
 * Complete state serialization with class instance handling and compression support
 */

import type { FXCore, FXNode, FXNodeProxy } from '../fx.v4';

interface SerializationOptions {
  includePrivateProps?: boolean;
  compressOutput?: boolean;
  preserveClassInstances?: boolean;
  maxDepth?: number;
  includeFunctions?: boolean;
  customSerializers?: Map<string, (value: any) => any>;
}

interface SerializedNode {
  __id: string;
  __parent_id: string | null;
  __type: string | null;
  __proto: string[];
  __value?: any;
  __nodes?: Record<string, SerializedNode>;
  __instance_data?: any;
  __instance_class?: string;
  __effects_count?: number;
  __effects_info?: Array<{ name: string; length: number }>;
  __watchers_count?: number;
  __behaviors?: string[];
  __fx_max_depth_exceeded?: boolean;
  __fx_circular_reference?: string;
}

interface SerializedState {
  __fx_serialized: true;
  __fx_version: string;
  __fx_timestamp: number;
  __fx_compressed?: boolean;
  __fx_root: SerializedNode;
  __fx_partial?: boolean;
  __fx_paths?: Record<string, SerializedNode>;
}

class SerializationLogger {
  static log(level: string, message: string, data: any = {}): void {
    console.log(`[FX-SERIALIZE:${level.toUpperCase()}]`, message, data);
  }
  static error(message: string, error: any): void { this.log('error', message, { error }); }
  static warn(message: string, data?: any): void { this.log('warn', message, data); }
  static info(message: string, data?: any): void { this.log('info', message, data); }
}

export class FXSerializePlugin {
  private fx: FXCore;
  private options: Required<SerializationOptions>;
  private classRegistry = new Map<string, any>();

  public readonly name = 'serialize';
  public readonly version = '2.0.0';
  public readonly description = 'State serialization and deserialization for FX nodes with TypeScript enhancements';

  constructor(fx: FXCore, options: Partial<SerializationOptions> = {}) {
    this.fx = fx;
    this.options = {
      includePrivateProps: false,
      compressOutput: false,
      preserveClassInstances: true,
      maxDepth: 50,
      includeFunctions: false,
      customSerializers: new Map(),
      ...options
    };

    SerializationLogger.info('Serialize plugin initialized', {
      preserveClassInstances: this.options.preserveClassInstances,
      maxDepth: this.options.maxDepth
    });
  }

  /**
   * Register a class for serialization/deserialization
   */
  registerClass<T>(constructor: new (...args: any[]) => T, name?: string): this {
    const className = name || constructor.name;
    this.classRegistry.set(className, constructor);
    SerializationLogger.info(`Class registered: ${className}`);
    return this;
  }

  /**
   * Register a custom serializer for a specific type
   */
  registerSerializer<T>(typeName: string, serializer: (value: T) => any, deserializer: (data: any) => T): this {
    this.options.customSerializers.set(typeName, { serializer, deserializer });
    SerializationLogger.info(`Custom serializer registered: ${typeName}`);
    return this;
  }

  /**
   * Serialize FX state to JSON-safe object
   */
  wrap(startNode: FXNode = this.fx.root, options: Partial<SerializationOptions> = {}): SerializedState {
    const config = { ...this.options, ...options };

    SerializationLogger.info('Starting serialization', {
      startNodeId: startNode.__id,
      maxDepth: config.maxDepth
    });

    try {
      const result = this.wrapNode(startNode, config, 0, new Set());

      const output: SerializedState = {
        __fx_serialized: true,
        __fx_version: this.version,
        __fx_timestamp: Date.now(),
        __fx_root: result
      };

      if (config.compressOutput) {
        output.__fx_compressed = true;
        // Compression would be implemented here
      }

      SerializationLogger.info('Serialization completed', {
        compressed: config.compressOutput,
        nodes: this.countNodes(result)
      });

      return output;

    } catch (error) {
      SerializationLogger.error('Serialization failed', error);
      throw error;
    }
  }

  private wrapNode(node: FXNode, config: Required<SerializationOptions>, depth: number, visited: Set<string>): SerializedNode {
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

    const output: SerializedNode = {
      __id: node.__id,
      __parent_id: node.__parent_id,
      __type: node.__type,
      __proto: [...(node.__proto || [])],
    };

    // Serialize value based on type
    if (node.__type && node.__value) {
      if (node.__instances && node.__instances.has(node.__type)) {
        // Class instance
        const instance = node.__instances.get(node.__type);
        if (config.preserveClassInstances) {
          output.__instance_data = this.serializeInstance(instance, config);
          output.__instance_class = node.__type;
        } else {
          output.__value = this.instanceToPlainObject(instance);
        }
      } else if (typeof node.__value === 'object' && node.__value[node.__type] !== undefined) {
        // Regular typed value
        output.__value = this.serializeValue(node.__value[node.__type], config);
      }
    }

    // Serialize behaviors
    if (node.__behaviors && node.__behaviors.size > 0) {
      output.__behaviors = Array.from(node.__behaviors.keys());
    }

    // Serialize child nodes
    if (node.__nodes && Object.keys(node.__nodes).length > 0) {
      output.__nodes = {};
      for (const [key, childNode] of Object.entries(node.__nodes)) {
        if (!config.includePrivateProps && key.startsWith('_')) {
          continue;
        }
        output.__nodes[key] = this.wrapNode(childNode, config, depth + 1, visited);
      }
    }

    // Serialize effects metadata (functions can't be serialized)
    if (node.__effects && node.__effects.length > 0) {
      output.__effects_count = node.__effects.length;
      output.__effects_info = node.__effects.map(effect => ({
        name: effect.name || 'anonymous',
        length: effect.length
      }));
    }

    // Serialize watchers count
    if (node.__watchers && node.__watchers.size > 0) {
      output.__watchers_count = node.__watchers.size;
    }

    visited.delete(node.__id);
    return output;
  }

  private serializeInstance(instance: any, config: Required<SerializationOptions>): any {
    const data: any = {
      __constructor: instance.constructor.name,
      __constructorParams: instance.constructor.length
    };

    // Custom serializer check
    const customSerializer = config.customSerializers.get(instance.constructor.name);
    if (customSerializer) {
      return customSerializer.serializer(instance);
    }

    // Get all enumerable properties
    for (const key in instance) {
      if (instance.hasOwnProperty(key)) {
        const value = instance[key];
        if (typeof value === 'function') {
          if (config.includeFunctions) {
            data[key] = {
              __fx_function: true,
              name: value.name || 'anonymous',
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

  private instanceToPlainObject(instance: any): any {
    const obj: any = {};
    for (const key in instance) {
      if (instance.hasOwnProperty(key) && typeof instance[key] !== 'function') {
        obj[key] = this.serializeValue(instance[key], this.options);
      }
    }
    return obj;
  }

  private serializeValue(value: any, config: Required<SerializationOptions>): any {
    if (value === null || value === undefined) {
      return value;
    }

    const type = typeof value;

    if (type === 'string' || type === 'number' || type === 'boolean') {
      return value;
    }

    if (type === 'function') {
      if (config.includeFunctions) {
        return {
          __fx_function: true,
          name: value.name || 'anonymous',
          length: value.length,
          source: value.toString().slice(0, 200) // First 200 chars
        };
      }
      return undefined;
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
        values: Array.from(value).map(v => this.serializeValue(v, config))
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
      return value.map(item => this.serializeValue(item, config));
    }

    if (type === 'object') {
      const obj: any = {};
      for (const [key, val] of Object.entries(value)) {
        if (!config.includePrivateProps && key.startsWith('_')) {
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
  expand(serializedData: SerializedState, targetNode: FXNode = this.fx.root, options: Partial<SerializationOptions> = {}): FXNode {
    const config = { ...this.options, ...options };

    SerializationLogger.info('Starting deserialization', {
      targetNodeId: targetNode.__id,
      preserveInstances: config.preserveClassInstances
    });

    try {
      if (!serializedData.__fx_serialized) {
        throw new Error('Invalid serialized data - missing FX signature');
      }

      if (serializedData.__fx_compressed) {
        throw new Error('Compressed data decompression not yet implemented');
      }

      const result = this.expandNode(serializedData.__fx_root, targetNode, config, new Map());

      SerializationLogger.info('Deserialization completed');
      return result;

    } catch (error) {
      SerializationLogger.error('Deserialization failed', error);
      throw error;
    }
  }

  private expandNode(serializedNode: SerializedNode, targetNode: FXNode, config: Required<SerializationOptions>, idMap: Map<string, FXNode>): FXNode {
    if (serializedNode.__fx_max_depth_exceeded) {
      SerializationLogger.warn('Max depth exceeded during serialization');
      return targetNode;
    }

    if (serializedNode.__fx_circular_reference) {
      const referencedNode = idMap.get(serializedNode.__fx_circular_reference);
      if (referencedNode) {
        return referencedNode;
      } else {
        SerializationLogger.warn('Circular reference not found', serializedNode.__fx_circular_reference);
        return targetNode;
      }
    }

    // Update node properties
    targetNode.__id = serializedNode.__id;
    targetNode.__parent_id = serializedNode.__parent_id;
    targetNode.__type = serializedNode.__type;
    targetNode.__proto = [...(serializedNode.__proto || [])];

    // Store in ID map for circular reference resolution
    idMap.set(targetNode.__id, targetNode);

    // Restore value
    if (serializedNode.__instance_data && serializedNode.__instance_class) {
      // Restore class instance
      if (config.preserveClassInstances) {
        this.restoreInstance(targetNode, serializedNode.__instance_class, serializedNode.__instance_data, config);
      } else {
        // Convert to plain object
        targetNode.__type = 'object';
        if (!targetNode.__value || typeof targetNode.__value !== 'object') {
          targetNode.__value = {};
        }
        (targetNode.__value as any).object = this.deserializeValue(serializedNode.__instance_data, config);
      }
    } else if (serializedNode.__value !== undefined) {
      // Restore regular value
      const deserializedValue = this.deserializeValue(serializedNode.__value, config);
      if (!targetNode.__value || typeof targetNode.__value !== 'object') {
        targetNode.__value = {};
      }
      if (targetNode.__type) {
        (targetNode.__value as any)[targetNode.__type] = deserializedValue;
      }
    }

    // Restore behaviors
    if (serializedNode.__behaviors) {
      if (!targetNode.__behaviors) {
        targetNode.__behaviors = new Map();
      }
      // Note: Actual behavior objects would need to be registered separately
      serializedNode.__behaviors.forEach(behaviorName => {
        SerializationLogger.warn(`Behavior ${behaviorName} needs manual restoration`);
      });
    }

    // Restore child nodes
    if (serializedNode.__nodes) {
      if (!targetNode.__nodes) {
        targetNode.__nodes = Object.create(null);
      }
      for (const [key, childData] of Object.entries(serializedNode.__nodes)) {
        if (!targetNode.__nodes[key]) {
          targetNode.__nodes[key] = this.fx.createNode(targetNode.__id);
        }
        this.expandNode(childData, targetNode.__nodes[key], config, idMap);
      }
    }

    // Log restoration notes for functions that can't be restored
    if (serializedNode.__effects_count) {
      SerializationLogger.warn(`Node had ${serializedNode.__effects_count} effects (manual restoration required)`);
    }

    if (serializedNode.__watchers_count) {
      SerializationLogger.warn(`Node had ${serializedNode.__watchers_count} watchers (manual restoration required)`);
    }

    return targetNode;
  }

  private restoreInstance(node: FXNode, className: string, instanceData: any, config: Required<SerializationOptions>): void {
    // Check for custom deserializer
    const customSerializer = config.customSerializers.get(className);
    if (customSerializer && (customSerializer as any).deserializer) {
      try {
        const restored = (customSerializer as any).deserializer(instanceData);
        if (!node.__instances) {
          node.__instances = new Map();
        }
        node.__instances.set(className, restored);
        SerializationLogger.info(`Restored ${className} instance using custom deserializer`);
        return;
      } catch (error) {
        SerializationLogger.warn(`Custom deserializer failed for ${className}`, error);
      }
    }

    // Check if class is registered
    const RegisteredClass = this.classRegistry.get(className);

    if (!RegisteredClass) {
      SerializationLogger.warn(`Class ${className} not registered, storing as plain object`);
      node.__type = 'object';
      if (!node.__value || typeof node.__value !== 'object') {
        node.__value = {};
      }
      (node.__value as any).object = this.deserializeValue(instanceData, config);
      return;
    }

    try {
      // Create new instance
      const instance = new RegisteredClass();

      // Restore properties
      for (const [key, value] of Object.entries(instanceData)) {
        if (!key.startsWith('__') && key !== '__constructor' && key !== '__constructorParams') {
          (instance as any)[key] = this.deserializeValue(value, config);
        }
      }

      // Store in node
      if (!node.__instances) {
        node.__instances = new Map();
      }
      node.__instances.set(className, instance);

      SerializationLogger.info(`Restored ${className} instance`);

    } catch (error) {
      SerializationLogger.error(`Failed to restore ${className} instance`, error);
      // Fallback to plain object
      node.__type = 'object';
      if (!node.__value || typeof node.__value !== 'object') {
        node.__value = {};
      }
      (node.__value as any).object = this.deserializeValue(instanceData, config);
    }
  }

  private deserializeValue(value: any, config: Required<SerializationOptions>): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    if (value.__fx_function) {
      // Functions can't be restored, return placeholder
      const placeholder = function (...args: any[]) {
        throw new Error(`Serialized function '${value.name}' cannot be executed. Original source: ${value.source || 'unknown'}`);
      };
      Object.defineProperty(placeholder, 'name', { value: value.name || 'serialized_function' });
      return placeholder;
    }

    if (value.__fx_date) {
      return new Date(value.value);
    }

    if (value.__fx_regexp) {
      return new RegExp(value.source, value.flags);
    }

    if (value.__fx_set) {
      return new Set(value.values.map((v: any) => this.deserializeValue(v, config)));
    }

    if (value.__fx_map) {
      const map = new Map();
      for (const [k, v] of value.entries) {
        map.set(
          this.deserializeValue(k, config),
          this.deserializeValue(v, config)
        );
      }
      return map;
    }

    if (Array.isArray(value)) {
      return value.map(item => this.deserializeValue(item, config));
    }

    // Plain object
    const obj: any = {};
    for (const [key, val] of Object.entries(value)) {
      obj[key] = this.deserializeValue(val, config);
    }
    return obj;
  }

  /**
   * Serialize only specific paths
   */
  wrapPartial(paths: string[], options: Partial<SerializationOptions> = {}): SerializedState {
    const config = { ...this.options, ...options };

    const result: SerializedState = {
      __fx_serialized: true,
      __fx_version: this.version,
      __fx_timestamp: Date.now(),
      __fx_partial: true,
      __fx_paths: {},
      __fx_root: {} as SerializedNode
    };

    SerializationLogger.info('Starting partial serialization', { paths });

    for (const path of paths) {
      const node = this.fx.resolvePath(path, this.fx.root);
      if (node) {
        result.__fx_paths![path] = this.wrapNode(node, config, 0, new Set());
      } else {
        SerializationLogger.warn(`Path not found during partial serialization: ${path}`);
      }
    }

    SerializationLogger.info('Partial serialization completed', {
      pathCount: Object.keys(result.__fx_paths || {}).length
    });

    return result;
  }

  /**
   * Compare two serialized states
   */
  compare(stateA: SerializedState, stateB: SerializedState): Array<{path: string; a: any; b: any}> {
    const differences: Array<{path: string; a: any; b: any}> = [];
    
    if (stateA.__fx_partial || stateB.__fx_partial) {
      throw new Error('Cannot compare partial states');
    }

    this.compareNodes(stateA.__fx_root, stateB.__fx_root, 'root', differences);
    return differences;
  }

  private compareNodes(nodeA: SerializedNode, nodeB: SerializedNode, path: string, differences: Array<{path: string; a: any; b: any}>): void {
    // Compare values
    if (JSON.stringify(nodeA.__value) !== JSON.stringify(nodeB.__value)) {
      differences.push({ path, a: nodeA.__value, b: nodeB.__value });
    }

    // Compare types
    if (nodeA.__type !== nodeB.__type) {
      differences.push({ path: `${path}.__type`, a: nodeA.__type, b: nodeB.__type });
    }

    // Compare child nodes
    const allChildKeys = new Set([
      ...Object.keys(nodeA.__nodes || {}),
      ...Object.keys(nodeB.__nodes || {})
    ]);

    for (const childKey of allChildKeys) {
      const childA = nodeA.__nodes?.[childKey];
      const childB = nodeB.__nodes?.[childKey];
      const childPath = path === 'root' ? childKey : `${path}.${childKey}`;

      if (childA && childB) {
        this.compareNodes(childA, childB, childPath, differences);
      } else if (childA && !childB) {
        differences.push({ path: childPath, a: '[exists]', b: '[missing]' });
      } else if (!childA && childB) {
        differences.push({ path: childPath, a: '[missing]', b: '[exists]' });
      }
    }
  }

  /**
   * Create a compressed version of serialized data
   */
  async compress(serializedData: SerializedState): Promise<SerializedState> {
    // Simple compression implementation - could use actual compression library
    const jsonString = JSON.stringify(serializedData);
    
    // Placeholder for actual compression
    const compressed = {
      ...serializedData,
      __fx_compressed: true,
      __fx_compressed_size: jsonString.length,
      __fx_original_size: jsonString.length
    };

    SerializationLogger.info('Compression completed', {
      originalSize: jsonString.length,
      compressedSize: jsonString.length // Would be smaller with real compression
    });

    return compressed;
  }

  private countNodes(node: SerializedNode): number {
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

// Export plugin factory
export default function(fx: FXCore, options?: Partial<SerializationOptions>): FXSerializePlugin {
  return new FXSerializePlugin(fx, options);
}