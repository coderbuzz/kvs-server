<!-- docs: sync from coderbuzz/codex@4b7f24c -->

# KVS Server — AI Agent Knowledge File

**Package:** `@coderbuzz/kvs-server` v0.1.10
**Purpose:** HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`. Exposes `KVStore` or `AsyncKVStore` as a network-accessible server.
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`).

---

## Mental Model

```
Sync:  KVStore("kv.db")  +  createServer(store, opts)  →  AppServer
Async: AsyncKVStore(...) +  createAsyncServer(store, opts) →  AppServer
```

Both return a velox `AppServer` — call `.run()` to start, `.stop()` to stop.

---

## Complete Import Map

```ts
import { KVStore, AsyncKVStore } from "@coderbuzz/kvs";
import {
  createServer,
  createAsyncServer,
  type CreateServerOptions,
  type CreateAsyncServerOptions,
} from "@coderbuzz/kvs-server";
```

Note: `CreateServerOptions` is **not** currently re-exported from the public barrel. Use `Parameters<typeof createServer>[1]` or import from `@coderbuzz/kvs-server/src/routes` if needed.

---

## Usage

### Sync

```ts
const store = new KVStore("kv.db");
const server = createServer(store, {
  port: 3000,
  hostname: "0.0.0.0",
  accessToken: "your-secret-token",
});
await server.run();
```

### Async (PostgreSQL)

```ts
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

## `createServer(store, options): AppServer`

Creates an HTTP server wrapping a sync `KVStore`.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `KVStore` | required | Sync store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

Returns a velox `AppServer` with methods: `.run()`, `.stop()`, `.printRoutes()`.

## `createAsyncServer(store, options): AppServer`

Same as `createServer` but wraps an async `AsyncKVStore`. All store calls are awaited internally.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `AsyncKVStore` | required | Async store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

---

## HTTP Endpoints

All endpoints except `GET /health` require: `Authorization: Bearer <ACCESS_TOKEN>`

Auth middleware is applied to `/kv/*` routes via `app.apply("/kv/*", bearerAuth({ token }))`.

### Health

```
GET /health
```
- **Auth:** No auth required
- **Response:** `{ "ok": true, "uptime": 123.456 }` — uptime in seconds from `process.uptime()`

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
- `ttl` is optional, milliseconds, min 0.

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
    { "key": [...], "value": ..., "version": ... },
    ...
  ],
  "cursor": "Xyz..." | null
}
```
- `cursor` is base64-encoded exclusive start key for pagination. `null` = no more pages.
- Default `limit` on store side: 100, max 1000.

#### `POST /kv/atomic`

```json
// Request
{
  "checks": [
    { "key": ["counter"], "version": 3 },       // must be at version 3
    { "key": ["new-key"], "version": null }      // must not exist
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
Deletes ALL data from `kv` and `queue` tables. Clears all watchers.

#### `POST /kv/clean-expired`

```json
// Request
{}

// Response
{ "ok": true, "deleted": 42 }
```
Manually delete expired KV entries. Returns count of removed rows. (Auto-runs every 60s on server.)

### Queue Endpoints (all POST, currently NOT behind auth middleware)

⚠️ **Note:** Queue endpoints (`/queue/*`) are currently NOT covered by the `/kv/*` auth apply. They may be unauthenticated in the current source. Check the source if auth is critical.

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

#### `POST /queue/ack`

```json
// Request
{ "id": 1 }

// Response
{ "ok": true }
```
- Returns `"ok": false` if message not found or already processed.

---

## WebSocket Protocol

**Endpoint:** `ws://host:port/ws`

Uses JSON-RPC format. All methods mirror their REST counterparts.

**Velox WebSocket defaults:**
- `maxPayloadLength`: 16 MB
- `backpressureLimit`: 16 MB
- `pingInterval`: 30 s
- `pongTimeout`: 10 s
- `idleTimeout`: 120 s
- `perMessageDeflate`: disabled

### Auth (Required before any RPC call)

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

### All RPC Methods

| Method | Parameters | Result |
|---|---|---|
| `"/kv/get"` | `{ key: KvKey }` | `{ entry: KvEntry \| null }` |
| `"/kv/set"` | `{ key, value, ttl? }` | `KvCommitResult` |
| `"/kv/delete"` | `{ key }` | `{ ok: true }` |
| `"/kv/list"` | `{ prefix?, start?, end?, limit?, cursor?, reverse? }` | `KvListResult` |
| `"/kv/atomic"` | `{ checks?, mutations?, enqueues? }` | `KvCommitResult \| { ok: false }` |
| `"/kv/reset"` | `{}` | `{ ok: true }` |
| `"/kv/clean-expired"` | `{}` | `{ ok: true, deleted }` |
| `"/queue/enqueue"` | `{ payload, topic?, delay?, maxAttempts? }` | `{ ok: true, id }` |
| `"/queue/dequeue"` | `{ topic?, limit? }` | `{ messages: QueueMessage[] }` |
| `"/queue/ack"` | `{ id }` | `{ ok: boolean }` |

### WebSocket Watch

Subscribe to key-change notifications.

```json
// Client request:
{ "id": 5, "method": "/kv/watch", "params": { "keys": [["users", "123"], ["users", "456"]] } }
```

**Behavior:**
1. Only ONE watcher per connection — calling again cancels the previous.
2. Fires **immediately** with current values for all keys.
3. On every mutation (`set`/`delete`/`atomic.commit`/`increment`) to any watched key, fires again.
4. Fires the full set of current values for ALL watched keys (not just the changed one).

**Push message format:**
```json
{
  "type": "watch",
  "entries": [
    { "key": ["users", "123"], "value": { "name": "Alice" }, "version": 5 },
    null
  ]
}
```
- `entries` matches the order and length of requested `keys`. `null` for non-existent keys.

**Unwatch:**
```json
{ "id": 6, "method": "/kv/unwatch" }
```

### WebSocket Queue Listen

Push-based queue message delivery with work-stealing.

```json
// Client request:
{ "id": 7, "method": "/queue/listen", "params": { "topic": "emails" } }
```
- `topic` defaults to `"default"` if omitted.

**Behavior:**
1. One listener per topic per connection — calling again for the same topic cancels the previous.
2. Multiple topics per connection supported simultaneously.
3. Messages dispatched every 1s via round-robin across all listeners for the topic.
4. Callback fires for each dequeued message.

**Push message format:**
```json
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
```

**Unlisten:**
```json
{ "id": 8, "method": "/queue/unlisten", "params": { "topic": "emails" } }
```

### WebSocket Error Handling

- Unknown method (with `id`): `{ "id": N, "error": "Unknown method: <method>" }`
- Invalid JSON or parse failure (with `id`): `{ "id": N, "error": "<message>" }`
- Invalid JSON without `id`: `{ "error": "Invalid message" }`
- Handler errors (caught): `{ "id": N, "error": "<error message>" }`

### WebSocket Connection Cleanup

On WebSocket close:
1. Active watcher (if any) is canceled (removed from watch index).
2. All queue listeners are canceled (removed from listener sets, dispatch timer may stop).

---

## Internal Behavior

### Timers (from KVStore/AsyncKVStore — started in constructor, stopped on close())
- **TTL cleanup:** Every 60s — deletes rows where `expires_at <= now`
- **Failed message requeue:** Every 60s — requeues messages where `deliver_at <= now` AND `attempts < maxAttempts` AND status is not "done"
- **Queue dispatch:** Every 1s — dispatches deliverable messages to active listeners (round-robin)

### Watch Internals
- `watchIndex: Map<hex-encoded-key, Set<Watcher>>`
- On mutation → `notifyWatchers(encodedKey)` fires all watchers for that key
- Each watcher re-fetches ALL watched keys' current values on every fire
- Errors from individual watcher callbacks are silently caught

### Queue Dispatch Internals
- `queueListeners: Map<topic, Set<callback>>`
- `queueRRIndex: Map<topic, number>` — round-robin index
- `dispatchToListeners()`: dequeues one message at a time, distributes round-robin
- Timer starts on first listener, stops when all topics have no listeners

### Message Lifecycle
```
enqueue → pending → (dequeue by dispatch or manual) → processing
                         ↓ not acked within 30s
                      requeue → pending (up to maxAttempts)
                         ↓ ack'd
                       done (deleted)
```

### Value Serialization (store level)
- Values are stored as binary blobs with a 1-byte sentinel:
  - `0x00` = `null`, `0x01` = `true`, `0x02` = `false`
  - Everything else = `JSON.stringify` → `TextEncoder`

---

## Gotchas

1. `accessToken` is required in options — no default.
2. `createServer()` → sync store, `createAsyncServer()` → async store. Wrong pairing will cause runtime errors.
3. WebSocket auth can be via query param `?token=` OR post-connect `auth` RPC. Both are supported.
4. Only ONE watcher per WebSocket connection — calling `/kv/watch` again cancels the previous.
5. Queue listeners are per-topic per-connection — calling `/queue/listen` for same topic overwrites.
6. Queue endpoints (`/queue/*`) are currently NOT behind the auth middleware (only `/kv/*` is). This may be a bug — verify before deploying to production.
7. `reset()` deletes ALL data and cancels all watchers. Not reversible.
8. The server uses velox internally — `AppServer` has `.printRoutes()` for debugging registered endpoints.
