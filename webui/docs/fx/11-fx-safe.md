# FX Safe Plugin

**Plugin name:** `safe`
**Version:** 1.0.0

FX Safe provides production resilience patterns for FX operations: circuit breakers, retry with exponential backoff, and fallback strategies. These patterns protect your application from cascading failures when calling unreliable services, performing I/O, or executing operations that may intermittently fail.

---

## Overview

FX Safe offers three complementary patterns:

| Pattern | Purpose | When to use |
|---|---|---|
| **Retry** | Automatically re-attempt a failed operation with increasing delays. | Transient failures: network timeouts, temporary unavailability, lock contention. |
| **Circuit Breaker** | Stop calling a failing service entirely, then gradually recover. | Sustained failures: a downstream service is down and hammering it makes things worse. |
| **Fallback** | Run a primary operation, and if it fails, use an alternative. | When you have a degraded-but-acceptable alternative: cached data, default values, secondary service. |

All three patterns automatically track statistics in the FX tree under `safe.stats.*`, giving you observability for free.

---

## Retry

Retry re-executes a failing operation with exponential backoff and optional jitter.

### RetryOptions

| Field | Type | Default | Description |
|---|---|---|---|
| `max_attempts` | `u32` | `3` | Maximum number of attempts (including the first). |
| `backoff_ms` | `u64` | `100` | Initial delay in milliseconds before the first retry. |
| `multiplier` | `f64` | `2.0` | Multiply the delay by this factor after each retry. |
| `jitter` | `bool` | `true` | Randomize delay (0.5x-1.0x) to prevent thundering herd. |

### Usage

```rust
// Rust
let result = safe.retry("fetch_user", || {
    http_client.get("https://api.example.com/users/1")
}, RetryOptions {
    max_attempts: 5,
    backoff_ms: 200,
    multiplier: 2.0,
    jitter: true,
});

match result {
    Ok(user) => println!("Got user: {:?}", user),
    Err(e) => eprintln!("All retries exhausted: {:?}", e),
}
```

### Backoff sequence example

With `backoff_ms: 100`, `multiplier: 2.0`, and `jitter: true`:

| Attempt | Base delay | With jitter (range) |
|---|---|---|
| 1 (initial) | -- | immediate |
| 2 (1st retry) | 100ms | 50-100ms |
| 3 (2nd retry) | 200ms | 100-200ms |
| 4 (3rd retry) | 400ms | 200-400ms |

### Statistics

Each named operation tracks its retry count in the FX tree:

```
safe.stats.<name>.successes  -- total successful calls
safe.stats.<name>.retries    -- total retry attempts
```

---

## Circuit Breaker

A circuit breaker monitors failure rates and temporarily blocks calls to a failing service, giving it time to recover.

### CircuitOptions

| Field | Type | Default | Description |
|---|---|---|---|
| `threshold` | `u32` | `5` | Number of consecutive failures before the circuit opens. |
| `timeout_ms` | `u64` | `30000` | How long the circuit stays open before trying again (milliseconds). |
| `reset_threshold` | `u32` | `3` | Number of consecutive successes in half-open state needed to close the circuit. |

### States

The circuit breaker transitions through three states:

```
         failures >= threshold
  Closed -----------------------> Open
    ^                               |
    |                               | timeout elapsed
    |  successes >= reset_threshold |
    +--------- HalfOpen <----------+
```

| State | Behavior |
|---|---|
| **Closed** | All calls pass through normally. Failures are counted. |
| **Open** | All calls fail immediately with `CircuitOpen` error. No work is attempted. |
| **HalfOpen** | A single probe call is allowed through. If it succeeds, the success counter increments. After `reset_threshold` successes, the circuit closes. If it fails, the circuit re-opens. |

### Usage

```rust
// Rust
let result = safe.circuit("payment_gateway", || {
    payment_client.charge(amount)
}, CircuitOptions {
    threshold: 3,
    timeout_ms: 60_000,
    reset_threshold: 2,
});

match result {
    Ok(receipt) => println!("Charged: {:?}", receipt),
    Err(FXError::CircuitOpen) => println!("Payment service is down, try later"),
    Err(e) => eprintln!("Payment failed: {:?}", e),
}
```

### State in FX tree

The current circuit state is stored at `safe.circuits.<name>.state` and can be inspected at any time:

```rust
let state = fx.proxy("safe.circuits.payment_gateway.state").str();
// "Closed", "Open", or "HalfOpen"
```

---

## Fallback

The fallback pattern executes a primary operation and, if it fails, runs a fallback function that receives the error. The fallback always returns a value (it cannot fail).

### Usage

```rust
// Rust
let user = safe.with_fallback("load_user",
    || {
        // Primary: fetch from remote API
        api.get_user(user_id)
    },
    |err| {
        // Fallback: return cached data
        eprintln!("API failed: {:?}, using cache", err);
        cache.get_user(user_id).unwrap_or(User::anonymous())
    },
);
```

### Statistics

Fallback invocations are tracked at `safe.stats.<name>.fallbacks`.

---

## Combining Patterns

The patterns compose naturally. A common production setup wraps retry inside a circuit breaker with a fallback:

```rust
// Retry inside circuit breaker with fallback
let data = safe.with_fallback("critical_service",
    || {
        safe.circuit("critical_service", || {
            safe.retry("critical_service", || {
                fetch_from_service()
            }, RetryOptions::default())
        }, CircuitOptions::default())
    },
    |err| {
        log::warn!("Service unavailable: {:?}", err);
        get_cached_data()
    },
);
```

Execution flow:
1. **Retry** handles transient glitches (up to 3 attempts).
2. **Circuit breaker** stops retrying if failures accumulate (opens after 5 failures).
3. **Fallback** provides a graceful degradation when the circuit is open or all retries fail.

---

## When to Use Each Pattern

| Scenario | Pattern |
|---|---|
| Network call that sometimes times out | Retry |
| Database connection that drops intermittently | Retry |
| External API that goes down for minutes at a time | Circuit breaker |
| Service that degrades gradually under load | Circuit breaker + Retry |
| Feature that can work offline with cached data | Fallback |
| Critical path where you need both reliability and graceful degradation | All three combined |

---

## FX Flow Integration

FX Flow nodes with `retry: true` use the same backoff algorithm as FX Safe. When the Safe plugin is loaded and `useSafePlugin: true` is set in the TypeScript flow node retry config, retry is delegated to the Safe plugin for unified statistics tracking.

```ts
// TypeScript flow node that delegates retry to fx-safe
{
  runsOn: "server",
  effect: (ctx) => { /* unreliable operation */ },
  retry: {
    maxAttempts: 3,
    useSafePlugin: true,
  },
}
```
