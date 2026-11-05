# FX Plugin Index

Installed plugins in this project (21 total).

Use `fx --add <name>` to add more plugins, or `fx --remove <name>` to remove.

---

## Core UI

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **dom** | `$dom` | client | — | [ref](./20-fx-dom-dollar.md) | jQuery-like reactive DOM binding |
| **components** | `$components` | client | dom | [ref](./21-fx-components.md) | Declarative .fxc component system |
| **router** | `$router` | client | — | [ref](./24-fx-router.md) | SPA page routing |
| **pages** | `$pages` | client | router | [ref](./25-fx-pages.md) | Page lifecycle management |
| **markdown** | `$markdown` | both | dom | — | Markdown to HTML with runnable code blocks |

## Data & State

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **flow** | `$flow` | both | safe, serialize | [ref](./10-fx-flow.md) | Dynamic procedure graphs (BFS/DFS) |
| **cache** | `$cache` | both | — | [ref](./15-fx-cache.md) | Multi-tier LRU cache with TTL |
| **orm** | `$orm` | both | cache | [ref](./26-fx-orm.md) | Zero-latency DB with CSS queries |
| **serialize** | `$serialize` | both | — | [ref](./32-fx-serialize.md) | State serialization with class preservation |
| **filesystem** | `$fs` | both | serialize | [ref](./31-fx-filesystem.md) | RamDisk persistence |

## Resilience & Reactivity

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **safe** | `$safe` | both | — | [ref](./11-fx-safe.md) | Circuit breaker, retry, fallback |
| **atomics** | `$atomics` | both | — | [ref](./12-fx-atomics.md) | Bi-directional node entanglement |
| **time-travel** | `$timeTravel` | both | serialize | [ref](./13-fx-time-travel.md) | Snapshots, undo/redo, timeline branching |

## Developer Tools

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **devtools** | `$devtools` | both | — | [ref](./14-fx-debug.md) | Developer console with commands |
| **visualizer** | `$viz` | both | — | — | Graph export (D3.js, Graphviz) |

## Network & Server

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **api** | `$api` | both | — | [ref](./27-fx-api.md) | HTTP API client |
| **hono** | `$hono` | server | flow, orm | [ref](./28-fx-hono.md) | Hono web framework integration |
| **server** | `$server` | server | — | [ref](./29-fx-server.md) | Enhanced Deno server |
| **relay** | `$relay` | both | serialize | [ref](./30-fx-relay.md) | Real-time binary patch streaming (WebSocket) |

## Workers & Service Workers

| Plugin | Global | Env | Deps | Docs | Description |
|--------|--------|-----|------|------|-------------|
| **flow-worker** | `$flowWorker` | client | flow | — | Flow worker bridge |
| **sw-register** | `$sw` | client | — | — | Service worker registration |
