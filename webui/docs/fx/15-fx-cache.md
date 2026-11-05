# FX Cache Plugin

The Cache plugin provides a multi-tier LRU cache with TTL-based expiration, tag-based invalidation, and namespace support. All statistics are stored in FX nodes for full observability.

## Initialization

```rust
use fx_rust::fx_cache::{CachePlugin, CacheConfig, CacheOptions};

let cache = CachePlugin::new(FXLogger::default(), CacheConfig::default());
cache.initialize(Arc::clone(&fx))?;
```

## CacheConfig

Configure the cache at creation time:

| Field | Type | Default | Description |
|---|---|---|---|
| `max_entries` | `usize` | `10,000` | Maximum number of entries before LRU eviction |
| `max_memory` | `usize` | `50 MB` | Maximum approximate memory usage in bytes |
| `default_ttl` | `Duration` | `1 hour` | Default time-to-live for entries |
| `auto_cleanup` | `bool` | `true` | Whether to auto-cleanup expired entries |
| `cleanup_interval` | `Duration` | `5 minutes` | How often expired entries are cleaned up |

```rust
let config = CacheConfig {
    max_entries: 5_000,
    max_memory: 25 * 1024 * 1024,  // 25MB
    default_ttl: Duration::from_secs(1800),  // 30 minutes
    ..Default::default()
};
let cache = CachePlugin::new(logger, config);
```

## CacheOptions

Per-operation options override the global config:

| Field | Type | Default | Description |
|---|---|---|---|
| `ttl` | `Option<Duration>` | `None` (uses config default) | Override TTL for this entry |
| `tags` | `Vec<String>` | `[]` | Tags for group invalidation |
| `namespace` | `Option<String>` | `None` (uses `"default"`) | Namespace partition |

## Basic Operations

### set / get

```rust
// Simple set and get
cache.set("my-key", FXValue::from("hello"), CacheOptions::default());
let val = cache.get("my-key", None);  // Some(FXValue::String("hello"))

// With custom TTL and tags
cache.set("xpath.compiled.expr1", compiled_value, CacheOptions {
    ttl: Some(Duration::from_secs(3600)),
    tags: vec!["xpath".into(), "compiled".into()],
    namespace: Some("xpath".into()),
    ..Default::default()
});

// Get from a specific namespace
let val = cache.get("compiled.expr1", Some("xpath"));
```

### get_or_set

The `get_or_set` pattern returns the cached value if present, otherwise calls the compute function, caches the result, and returns it. This is the recommended pattern for transparent caching:

```rust
let value = cache.get_or_set(
    "expensive-key",
    || {
        // This closure only runs on cache miss
        expensive_computation()
    },
    CacheOptions::default()
);
```

On the second call with the same key, the cached value is returned without invoking the closure:

```rust
let v1 = cache.get_or_set("key", || FXValue::from(42), CacheOptions::default());
assert_eq!(v1.to_num(), 42.0);

let v2 = cache.get_or_set("key", || FXValue::from(99), CacheOptions::default());
assert_eq!(v2.to_num(), 42.0);  // Still 42 -- cache hit
```

### remove

```rust
cache.remove("my-key", None);                // Remove from default namespace
cache.remove("compiled.expr1", Some("xpath")); // Remove from specific namespace
```

## Namespace Support

Namespaces partition the cache into isolated key spaces. Keys are stored internally as `namespace:key`.

```rust
// Store in the "xpath" namespace
cache.set("expr1", val, CacheOptions {
    namespace: Some("xpath".into()),
    ..Default::default()
});

// Store in the "xslt" namespace (same key name, different namespace)
cache.set("expr1", other_val, CacheOptions {
    namespace: Some("xslt".into()),
    ..Default::default()
});

// Clear only the xpath namespace
cache.clear(Some("xpath"));

// Clear everything
cache.clear(None);
```

## Tag-Based Invalidation

Tags allow you to invalidate groups of related entries regardless of their keys or namespaces:

```rust
cache.set("a", FXValue::from(1), CacheOptions {
    tags: vec!["xpath".into()],
    ..Default::default()
});
cache.set("b", FXValue::from(2), CacheOptions {
    tags: vec!["xslt".into()],
    ..Default::default()
});
cache.set("c", FXValue::from(3), CacheOptions {
    tags: vec!["xpath".into(), "hot".into()],
    ..Default::default()
});

// Invalidate all entries tagged "xpath" (removes "a" and "c")
cache.invalidate_by_tag("xpath");

assert!(cache.get("a", None).is_none());   // Gone
assert!(cache.get("b", None).is_some());   // Still here (tagged "xslt")
assert!(cache.get("c", None).is_none());   // Gone
```

## Eviction Policies

The cache enforces two eviction limits. When either is exceeded, the least-recently-used entries are evicted.

### By Count

When the number of entries reaches `max_entries`, the LRU entry is evicted before the new one is inserted.

```rust
let config = CacheConfig { max_entries: 3, ..Default::default() };
let cache = CachePlugin::new(logger, config);

cache.set("a", FXValue::from(1), opts());
cache.set("b", FXValue::from(2), opts());
cache.set("c", FXValue::from(3), opts());
cache.get("a", None);  // Touch "a" to update its access time
cache.set("d", FXValue::from(4), opts());  // Evicts "b" (least recently used)

assert!(cache.get("a", None).is_some());  // Kept (recently accessed)
assert!(cache.get("b", None).is_none());  // Evicted
```

### By Memory

When total estimated memory exceeds `max_memory`, entries are evicted LRU-first until enough space is freed. Memory size is estimated per entry based on the FXValue type.

## Expired Entry Cleanup

Entries with expired TTLs are lazily removed on access. You can also trigger a manual cleanup:

```rust
let removed_count = cache.cleanup_expired();
```

The cache also exposes cleanup as an FX method:

```rust
// Call via FX method system
fx.proxy("plugins.methods.cache.cleanup").call(FXValue::Null);
fx.proxy("plugins.methods.cache.clear").call(FXValue::Null);
```

## Hit/Miss Statistics

Statistics are stored in FX nodes and update in real time:

| FX Path | Description |
|---|---|
| `cache.stats.hits` | Total cache hits |
| `cache.stats.misses` | Total cache misses |
| `cache.stats.hit_rate` | Hit rate as a ratio (0.0 to 1.0) |
| `cache.stats.entries` | Current number of entries |
| `cache.stats.memory_bytes` | Approximate memory usage in bytes |

```rust
let hits     = fx.proxy("cache.stats.hits").num();
let misses   = fx.proxy("cache.stats.misses").num();
let hit_rate = fx.proxy("cache.stats.hit_rate").num();
let entries  = fx.proxy("cache.stats.entries").num();
let memory   = fx.proxy("cache.stats.memory_bytes").num();

println!("Cache: {} entries, {:.1}% hit rate, {:.1}KB memory",
    entries, hit_rate * 100.0, memory / 1024.0);
```

## Complete Example

```rust
let fx = Arc::new(FXCore::new(logger.clone()));
let cache = CachePlugin::new(logger.clone(), CacheConfig {
    max_entries: 10_000,
    max_memory: 50 * 1024 * 1024,
    default_ttl: Duration::from_secs(3600),
    ..Default::default()
});
cache.initialize(Arc::clone(&fx))?;

// Cache compiled XPath expressions
let compiled = cache.get_or_set(
    "//book[@price > 10]",
    || compile_xpath("//book[@price > 10]"),
    CacheOptions {
        tags: vec!["xpath".into(), "compiled".into()],
        namespace: Some("xpath".into()),
        ..Default::default()
    }
);

// Cache XSLT template match results with shorter TTL
cache.set("match:book", match_result, CacheOptions {
    ttl: Some(Duration::from_secs(300)),
    tags: vec!["xslt".into(), "match".into()],
    ..Default::default()
});

// When the stylesheet changes, invalidate all compiled expressions
cache.invalidate_by_tag("compiled");

// Check cache performance
let rate = fx.proxy("cache.stats.hit_rate").num();
println!("Cache hit rate: {:.1}%", rate * 100.0);
```
