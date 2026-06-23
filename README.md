<!-- docs: sync from coderbuzz/codex@c0ec729 -->

# KVS Server &mdash; `@coderbuzz/kvs-server`

> **HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`.** Expose your KV store as a full-featured network API with WebSocket RPC, real-time watch, and push-based queue listeners.
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/kvs-server/blob/main/AI_KNOWLEDGE.md) for expert context.
<p align="center">
  <a href="https://www.npmjs.com/package/@coderbuzz/kvs-server"><img src="https://img.shields.io/npm/v/@coderbuzz/kvs-server.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@coderbuzz/kvs-server"><img src="https://img.shields.io/npm/dm/@coderbuzz/kvs-server.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/coderbuzz/kvs-server/blob/main/LICENSE"><img src="https://img.shields.io/github/license/coderbuzz/kvs-server.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/coderbuzz/kvs-server"><img src="https://img.shields.io/github/stars/coderbuzz/kvs-server.svg?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/coderbuzz/kvs-server/actions/workflows/ci.yml"><img src="https://github.com/coderbuzz/kvs-server/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/coderbuzz/kvs-server"><img src="https://codecov.io/gh/coderbuzz/kvs-server/graph/badge.svg" alt="Codecov" /></a>
</p>

KVS Server wraps `@coderbuzz/kvs` (`KVStore` or `AsyncKVStore`) into a production-ready HTTP server built on [velox](https://github.com/coderbuzz/velox) (uWebSockets.js). Handles authentication, routing, WebSocket upgrade, and protocol translation. Pair with `@coderbuzz/kvs-client` for the TypeScript client SDK.

---

## Why KVS Server?

`@coderbuzz/kvs` is the **store engine** (SQLite-backed KV operations). `@coderbuzz/kvs-server` is the **server layer** that exposes it over HTTP/WS. Separating them means:

- The **store** can be embedded directly in your app without HTTP overhead
- The **server** can be swapped, extended, or deployed independently
- No unnecessary HTTP dependencies in the core KV library

---

## Features

- **REST API** — full CRUD, list, atomic transactions, queue operations, manual expiry
- **WebSocket RPC** — lower latency than REST for high-throughput workloads
- **Bearer-token auth** — protects all endpoints (except `/health`)
- **WebSocket watch** — real-time key-change subscriptions with push delivery
- **Push-based queue** — work-stealing distribution across connected listeners
- **Health checks** — unauthenticated `/health` endpoint
- **Dual backend** — `createServer()` for sync `KVStore`, `createAsyncServer()` for async `AsyncKVStore` (PostgreSQL, async SQLite)
- **Request validation** — all endpoints validated via `@coderbuzz/veta`

---

## Benchmarks

Full results at **[github.com/coderbuzz/benchmarks](https://github.com/coderbuzz/benchmarks)**.

KVS Server transport overhead vs direct KVStore access (Apple M-series, Bun):

| Scenario | KVS direct | WS RPC | HTTP REST |
|---|---|---|---|
| set('k','v') | **158,732 ops/s** | 53,999 ops/s (2.9x) | 19,433 ops/s (8.2x) |
| get('k') — hit | **1,160,021 ops/s** | 55,723 ops/s (20.8x) | 24,973 ops/s (46.4x) |

HTTP REST overhead includes JSON serialization, TCP round-trip, and uWebSockets routing (~2-8x slower than direct). WebSocket RPC amortizes connection overhead and is ~2x faster than REST for writes and ~2x for reads.

---

## Installation

```sh
npm install @coderbuzz/kvs @coderbuzz/kvs-server
```

KVS Server requires `@coderbuzz/kvs` as a peer (the store engine).

---

## Quick Start

```ts
import { KVStore, AsyncKVStore } from "@coderbuzz/kvs";
import { createServer, createAsyncServer } from "@coderbuzz/kvs-server";

// Sync (SQLite via bun:sqlite)
const store = new KVStore("kv.db");
const server = createServer(store, {
  port: 3000,
  hostname: "0.0.0.0",
  accessToken: "your-secret-token",
});
await server.run();

// Async (SQLite or PostgreSQL via bun:sql)
const asyncStore = new AsyncKVStore("postgres://user:pass@localhost:5432/kvdb");
const asyncServer = createAsyncServer(asyncStore, {
  port: 3001,
  accessToken: "your-secret-token",
});
await asyncServer.run();
```

### Graceful Shutdown

```ts
// Sync
process.on("SIGINT", () => {
  store.close();
  process.exit(0);
});

// Async
process.on("SIGINT", async () => {
  await asyncStore.close();
  process.exit(0);
});
```

---

## API

### `createServer(store: KVStore, options: CreateServerOptions): AppServer`

Creates an HTTP server with REST + WebSocket endpoints wrapping a sync `KVStore`.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `KVStore` | required | Sync store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

Returns a velox `AppServer` instance with methods:

| Method | Description |
|---|---|
| `.run()` | Start the server |
| `.stop()` | Stop the server |
| `.printRoutes()` | Debug endpoint registration |

### `createAsyncServer(store: AsyncKVStore, options: CreateAsyncServerOptions): AppServer`

Same interface as `createServer` but accepts `AsyncKVStore` instead of `KVStore`. All store calls are awaited internally.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `AsyncKVStore` | required | Async store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

---

## HTTP Endpoints

All endpoints except `GET /health` require: `Authorization: Bearer <ACCESS_TOKEN>`

Auth middleware is applied to `/kv/*` routes. Queue endpoints (`/queue/*`) are **not** currently behind auth middleware (verify before production deploy).

### Health

```
GET /health
```

**Auth:** None.

**Response:**
```json
{ "ok": true, "uptime": 123.456 }
```
`uptime` in seconds from `process.uptime()`.

### KV Endpoints (all POST, all authenticated)

#### `POST /kv/get`

```json
// Request
{ "key": ["users", "alice"] }

// Response (found)
{ "entry": { "key": ["users", "alice"], "value": { "name": "Alice" }, "version": 1 } }

// Response (not found)
{ "entry": null }
```

#### `POST /kv/set`

```json
// Request
{ "key": ["users", "alice"], "value": { "name": "Alice" }, "ttl": 60000 }

// Response
{ "ok": true, "version": 1 }
```
- `ttl` optional, milliseconds, min 0.
- Every set increments `version` by 1.

#### `POST /kv/delete`

```json
// Request
{ "key": ["users", "alice"] }

// Response
{ "ok": true }
```

#### `POST /kv/list`

```json
// Request — prefix
{ "prefix": ["users"] }

// Request — range
{ "start": ["events", 1000], "end": ["events", 2000] }

// Request — paginated
{ "prefix": ["logs"], "limit": 20, "cursor": "Abc..." }

// Request — reverse
{ "prefix": ["logs"], "limit": 5, "reverse": true }

// Response
{
  "entries": [
    { "key": ["users", "alice"], "value": { "name": "Alice" }, "version": 1 },
    { "key": ["users", "bob"], "value": { "name": "Bob" }, "version": 1 }
  ],
  "cursor": "Xyz..." | null
}
```
- `cursor` is base64-encoded exclusive start key for pagination. `null` = no more pages.
- Default `limit`: 100, max 1000.

#### `POST /kv/atomic`

```json
// Request
{
  "checks": [
    { "key": ["counter"], "version": 3 },
    { "key": ["new-key"], "version": null }
  ],
  "mutations": [
    { "type": "set", "key": ["counter"], "value": 4 },
    { "type": "set", "key": ["meta"], "value": { "updatedAt": 123456 }, "ttl": 3600000 },
    { "type": "delete", "key": ["old-key"] }
  ],
  "enqueues": [
    {
      "payload": { "task": "notify" },
      "options": { "topic": "jobs", "delay": 0, "maxAttempts": 3 }
    }
  ]
}

// Response (success)
{ "ok": true, "version": 4 }

// Response (check failed)
{ "ok": false }
```
- All operations run in a single transaction. If any check fails, entire operation is rolled back.
- `version: null` = "key must not exist".
- `version: number` = "key must be at this exact version".
- All three sections (`checks`, `mutations`, `enqueues`) are optional but at least one should be present.

#### `POST /kv/reset`

```json
// Request
{}

// Response
{ "ok": true }
```
Deletes ALL data from `kv` and `queue` tables. Cancels all watchers.

#### `POST /kv/clean-expired`

```json
// Request
{}

// Response
{ "ok": true, "deleted": 42 }
```
Manually delete expired KV entries. Returns count of removed rows. Auto-runs every 60s on server.
Note: response field is `deleted` (keep existing API shape).

### Queue Endpoints (all POST)

#### `POST /queue/enqueue`

```json
// Request
{
  "payload": { "to": "user@example.com" },
  "topic": "emails",
  "delay": 5000,
  "maxAttempts": 5
}

// Response
{ "ok": true, "id": 1 }
```
- `topic` default: `"default"`, `delay` default: `0`, `maxAttempts` default: `3`.

#### `POST /queue/dequeue`

```json
// Request
{ "topic": "emails", "limit": 10 }

// Response
{
  "messages": [
    {
      "id": 1,
      "topic": "emails",
      "payload": { "to": "user@example.com" },
      "enqueuedAt": 1700000000000,
      "deliverAt": 1700000005000,
      "attempts": 0,
      "maxAttempts": 5
    }
  ]
}
```
- `topic` default: `"default"`, `limit` default: `1`.
- Messages moved to `"processing"` status. Not acked within 30s → auto-requeued (up to `maxAttempts`).

#### `POST /queue/ack`

```json
// Request
{ "id": 1 }

// Response
{ "ok": true }
```
Returns `"ok": false` if message not found or already processed.

---

## WebSocket

**Endpoint:** `ws://host:port/ws`

Uses JSON-RPC format. All methods mirror their REST counterparts. Server defaults:

| Setting | Value |
|---|---|
| `maxPayloadLength` | 16 MB |
| `backpressureLimit` | 16 MB |
| `pingInterval` | 30 s |
| `pongTimeout` | 10 s |
| `idleTimeout` | 120 s |
| `perMessageDeflate` | disabled |

### Auth

Two modes:

**Mode 1: Query parameter (pre-authenticated)**
```
ws://host:port/ws?token=ACCESS_TOKEN
```
- If token matches → connection upgraded with `authenticated: true`
- If token wrong → rejected with HTTP 401 `"Unauthorized"`
- If no `?token=` → connection upgraded with `authenticated: false` (must use Mode 2)

**Mode 2: Post-connect RPC auth**
```json
// Client sends (must be first message after connect):
{ "id": 1, "method": "auth", "params": { "token": "ACCESS_TOKEN" } }

// Server responds:
{ "id": 1, "result": { "ok": true } }
```
- If wrong token → `{ "id": 1, "error": "Unauthorized" }` + connection closed (code 4001)
- If any non-auth method sent before auth → `{ "id": 1, "error": "Unauthorized" }` + connection closed

### Message Format (JSON-RPC style)

**Client → Server (request):**
```json
{ "id": 1, "method": "/kv/get", "params": { "key": ["users", "alice"] } }
```

**Server → Client (response):**
```json
{ "id": 1, "result": { "entry": { "key": [...], "value": ..., "version": 1 } } }
```

**Server → Client (error):**
```json
{ "id": 1, "error": "Error message" }
```

**Server → Client (push — unsolicited, no `id`):**
```json
{ "type": "watch", "entries": [...] }
{ "type": "queue", "topic": "...", "message": {...} }
```

### RPC Methods

| Method | Parameters | Result |
|---|---|---|
| `auth` | `{ token: string }` | `{ ok: true }` |
| `/kv/get` | `{ key: KvKey }` | `{ entry: KvEntry \| null }` |
| `/kv/set` | `{ key, value, ttl? }` | `KvCommitResult` |
| `/kv/delete` | `{ key }` | `{ ok: true }` |
| `/kv/list` | `{ prefix?, start?, end?, limit?, cursor?, reverse? }` | `KvListResult` |
| `/kv/atomic` | `{ checks?, mutations?, enqueues? }` | `KvCommitResult \| { ok: false }` |
| `/kv/reset` | `{}` | `{ ok: true }` |
| `/kv/clean-expired` | `{}` | `{ ok: true, deleted }` |
| `/kv/watch` | `{ keys: KvKey[] }` | (no response — push events follow) |
| `/kv/unwatch` | `{}` | (no response) |
| `/queue/enqueue` | `{ payload, topic?, delay?, maxAttempts? }` | `{ ok: true, id }` |
| `/queue/dequeue` | `{ topic?, limit? }` | `{ messages: QueueMessage[] }` |
| `/queue/ack` | `{ id }` | `{ ok: boolean }` |
| `/queue/listen` | `{ topic }` | (no response — push events follow) |
| `/queue/unlisten` | `{ topic }` | (no response) |

### Watch

Subscribe to key-change notifications:

```json
// Subscribe
{ "id": 5, "method": "/kv/watch", "params": { "keys": [["config", "theme"], ["config", "lang"]] } }

// Push event (fires immediately + on every mutation)
{
  "type": "watch",
  "entries": [
    { "key": ["config", "theme"], "value": "dark", "version": 3 },
    { "key": ["config", "lang"], "value": "en", "version": 1 }
  ]
}

// Unsubscribe
{ "id": 6, "method": "/kv/unwatch" }
```

**Behavior:**
- Only ONE watcher per connection — calling again cancels the previous.
- Fires **immediately** with current values for all keys on subscribe.
- On every mutation (`set`/`delete`/`increment`/`atomic.commit`) to any watched key, fires again with full set of current values for ALL watched keys.
- `entries` matches the order and length of requested `keys`. `null` for non-existent keys.

### Queue Listen

Push-based queue message delivery with work-stealing (round-robin):

```json
// Subscribe
{ "id": 7, "method": "/queue/listen", "params": { "topic": "emails" } }

// Push event
{
  "type": "queue",
  "topic": "emails",
  "message": {
    "id": 1,
    "topic": "emails",
    "payload": { "to": "user@example.com" },
    "enqueuedAt": 1700000000000,
    "deliverAt": 1700000000000,
    "attempts": 1,
    "maxAttempts": 3
  }
}

// Unsubscribe
{ "id": 8, "method": "/queue/unlisten", "params": { "topic": "emails" } }
```

**Behavior:**
- One listener per topic per connection — calling again for same topic overwrites.
- Multiple topics per connection supported simultaneously.
- Messages dispatched every 1s via round-robin across all connected listeners for the topic.
- Callback fires for each dequeued message. Client must `acknowledge()` manually.

### Error Handling

| Scenario | Response |
|---|---|
| Unknown method (with `id`) | `{ "id": N, "error": "Unknown method: <method>" }` |
| Invalid JSON / parse failure (with `id`) | `{ "id": N, "error": "<message>" }` |
| Invalid JSON without `id` | `{ "error": "Invalid message" }` |
| Handler errors (caught) | `{ "id": N, "error": "<error message>" }` |

### Connection Cleanup

On WebSocket close:
1. Active watcher (if any) is canceled (removed from watch index).
2. All queue listeners are canceled (removed from listener sets). Dispatch timer may stop if no listeners remain.

---

## Message Lifecycle (Server-Side)

```
enqueue → pending
   ↓ (timer or manual dequeue)
processing → (acknowledge) → done (deleted)
   ↓ not acked within 30s
requeue → pending (up to maxAttempts)
```

- **TTL cleanup:** Every 60s — deletes rows where `expires_at <= now`
- **Failed message requeue:** Every 60s — requeues messages older than 30s with `attempts < maxAttempts`
- **Queue dispatch:** Every 1s — dispatches deliverable messages to active listeners

---

## Gotchas

1. `accessToken` is required — no default. Auth failures return 401.
2. `createServer()` → sync `KVStore`, `createAsyncServer()` → async `AsyncKVStore`. Wrong pairing causes runtime errors.
3. WebSocket auth can be via query param `?token=` OR post-connect `auth` RPC. Both are supported.
4. Only ONE watcher per WebSocket connection — calling `/kv/watch` again cancels the previous.
5. Queue listeners are per-topic per-connection — calling `/queue/listen` for same topic overwrites. Multiple topics per connection OK.
6. Queue endpoints (`/queue/*`) are currently NOT behind the auth middleware (only `/kv/*` is). Verify before deploying to production.
7. `reset()` deletes ALL data and cancels all watchers. Not reversible.
8. The server uses velox internally — `AppServer` has `.printRoutes()` for debugging registered endpoints.
9. TTL cleanup and message requeue timers run within the KVStore instance, not the server. They start on store construction, stop on store `.close()`.
10. No `increment` HTTP/WS endpoint — increment is a store-level operation, not exposed as a separate RPC. Use `get` + `set` or `atomic()` for counters.

---

## License

MIT &copy; 2026 Indra Gunawan
