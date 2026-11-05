# fx-serialize

State serialization and deserialization for FX node trees. Captures the full structure of an FX graph -- including class instances, metadata, behaviors, and child nodes -- into a JSON-safe format that can be stored, transmitted, and restored.

## Quick start

```ts
import serializePlugin from './plugins/fx-serialize';

const serializer = serializePlugin(fx, {
  preserveClassInstances: true,
  maxDepth: 50
});
```

## Serializing (wrap)

### Full state

```ts
const snapshot = serializer.wrap();
// SerializedState with __fx_root containing the entire tree
```

### From a specific node

```ts
const node = fx.resolvePath('app.users', fx.root);
const partial = serializer.wrap(node);
```

### Specific paths only

```ts
const selected = serializer.wrapPartial(['app.config', 'app.session']);
// SerializedState with __fx_partial: true and __fx_paths map
```

## Deserializing (expand)

```ts
serializer.expand(snapshot);                    // restores into fx.root
serializer.expand(snapshot, someOtherNode);     // restores into a specific node
```

## Class instance preservation

By default, class instances stored in FX nodes are serialized with their constructor name and all enumerable properties. To restore them, register the class first:

```ts
class UserModel {
  name = '';
  email = '';
  greet() { return `Hello, ${this.name}`; }
}

serializer.registerClass(UserModel);

// Now wrap/expand will preserve UserModel instances
const snapshot = serializer.wrap();
serializer.expand(snapshot); // UserModel instances are reconstructed
```

### Custom serializers

For types that need special handling:

```ts
serializer.registerSerializer<Date>(
  'SpecialDate',
  (date) => ({ iso: date.toISOString() }),           // serializer
  (data) => new Date(data.iso)                        // deserializer
);
```

## What gets serialized

| Data | Serialized as |
|------|---------------|
| Primitives (string, number, boolean) | As-is |
| `null` / `undefined` | As-is |
| `Date` | `{ __fx_date: true, value: ISO string }` |
| `RegExp` | `{ __fx_regexp: true, source, flags }` |
| `Set` | `{ __fx_set: true, values: [...] }` |
| `Map` | `{ __fx_map: true, entries: [[k, v], ...] }` |
| Arrays | Recursively serialized |
| Objects | Recursively serialized (private `_` props excluded by default) |
| Functions | Skipped by default; `includeFunctions: true` stores name, arity, and first 200 chars of source |
| Class instances | Constructor name + all properties (when `preserveClassInstances: true`) |

## Comparing snapshots

```ts
const before = serializer.wrap();
// ... make changes ...
const after = serializer.wrap();

const diffs = serializer.compare(before, after);
// [{ path: 'app.count', a: 0, b: 5 }, ...]
```

## Circular references and depth limits

- Circular references are detected and stored as `{ __fx_circular_reference: nodeId }`
- Nodes beyond `maxDepth` are stored as `{ __fx_max_depth_exceeded: true }`

Both are handled gracefully during deserialization.

## Serialized state format

```ts
interface SerializedState {
  __fx_serialized: true;
  __fx_version: string;
  __fx_timestamp: number;
  __fx_compressed?: boolean;
  __fx_root: SerializedNode;
  __fx_partial?: boolean;
  __fx_paths?: Record<string, SerializedNode>;
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
  __watchers_count?: number;
  __behaviors?: string[];
}
```

## Restoration notes

Effects, watchers, and behaviors cannot be serialized (they are functions). After expanding a snapshot:
- `__effects_count` and `__watchers_count` are logged as warnings
- Behaviors listed in `__behaviors` need to be re-attached manually

## Configuration

```ts
interface SerializationOptions {
  includePrivateProps?: boolean;       // default: false
  compressOutput?: boolean;            // default: false
  preserveClassInstances?: boolean;    // default: true
  maxDepth?: number;                   // default: 50
  includeFunctions?: boolean;          // default: false
  customSerializers?: Map<string, any>;
}
```
