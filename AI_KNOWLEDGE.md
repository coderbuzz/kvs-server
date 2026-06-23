<!-- docs: sync from coderbuzz/codex@c0ec729 -->

# KVS Server — AI Agent Knowledge File

**Package:** `@coderbuzz/kvs-server` v0.1.10
**Purpose:** HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`. Exposes `KVStore` or `AsyncKVStore` as a network-accessible server.
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`).
**Built on:** [velox](https://github.com/coderbuzz/velox) (uWebSockets.js) + [veta](https://github.com/coderbuzz/veta) (schema validation)

---

## Mental Model

```
Sync:  KVStore("kv.db")  +  createServer(store, opts)  →  AppServer
Async: AsyncKVStore(...) +  createAsyncServer(store, opts) →  AppServer
```

Both return a velox `AppServer` — call `.run()` to start, `.stop()` to stop, `.printRoutes()` to debug.

---

## Complete Import Map

```ts
import { KVStore, AsyncKVStore } from "@coderbuzz/kvs";
import {
  createServer,
  createAsyncServer,
  type CreateAsyncServerOptions,
} from "@coderbuzz/kvs-server";
```

Note: `CreateServerOptions` is not currently re-exported as a named type from the public barrel. Use `Parameters<typeof createServer>[1]` or import from `@coderbuzz/kvs-server/src/routes` if needed.

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
// Server listening on http://0.0.0.0:3000
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

Validated by veta: `key` must be `array(union([string, number, bigint, boolean, uint8array]), { min: 1 })`.

#### `POST /kv/set`

```json
// Request
{ "key": ["users", "alice"], "value": { "name": "Alice" }, "ttl": 60000 }

// Response
{ "ok": true, "version": 1 }
```
- `ttl` is optional, milliseconds, min 0.
- Value can be any JSON-serializable data.
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
- All fields optional: `prefix`, `start`, `end`, `limit` (min 1), `cursor`, `reverse`.
- `cursor` is base64-encoded exclusive start key for pagination. `null` = no more pages.
- Default `limit` on store side: 100, max 1000.

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
- Validation: `checks` → `array(object({ key: kvKey, version: nullable(number) }))`, `mutations` → `array(object({ type: union([literal("set"), literal("delete")]), key: kvKey, value: optional(unknown), ttl: optional(number({ min: 0 })) }))`, `enqueues` → `array(object({ payload: unknown, options: optional(object({ topic: optional(string), delay: optional(number({ min: 0 })), maxAttempts: optional(number({ min: 1 })) })) }))`.

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

**Note:** Queue endpoints (`/queue/*`) are currently NOT covered by the `/kv/*` auth apply. They may be unauthenticated in the current source. Check the source if auth is critical.

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
- Moves matching messages to `"processing"` status.

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
- If wrong token → `{ "id": 1, "error": "Unauthorized" }` + connection closed (code 4001, reason `"Unauthorized"`)
- If any non-auth method sent before auth → `{ "id": 1, "error": "Unauthorized" }` + connection closed

**Peer data shape:**
```ts
{ authenticated: boolean; queueListeners: Map<string, { cancel: () => void }> }
```
`authenticated` starts as `false` (Mode 2) or `true` (Mode 1 with valid `?token=`). `queueListeners` initializes as empty map on upgrade.

### Message Format (JSON-RPC style)

**Client → Server (request):**
```json
{ "id": 1, "method": "/kv/get", "params": { "key": ["users", "alice"] } }
```
- `id` is required for request-response methods. Optional for push-style methods (`watch`/`listen`).
- `method` must match one of the registered RPC methods.

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
| `auth` | `{ token: string }` | `{ ok: true }` |
| `/kv/get` | `{ key: KvKey }` | `{ entry: KvEntry \| null }` |
| `/kv/set` | `{ key, value, ttl? }` | `KvCommitResult` |
| `/kv/delete` | `{ key }` | `{ ok: true }` |
| `/kv/list` | `{ prefix?, start?, end?, limit?, cursor?, reverse? }` | `KvListResult` |
| `/kv/atomic` | `{ checks?, mutations?, enqueues? }` | `KvCommitResult \| { ok: false }` |
| `/kv/reset` | `{}` | `{ ok: true }` |
| `/kv/clean-expired` | `{}` | `{ ok: true, deleted }` |
| `/kv/watch` | `{ keys: KvKey[] }` | (no direct response — push events) |
| `/kv/unwatch` | `{}` | (no response) |
| `/queue/enqueue` | `{ payload, topic?, delay?, maxAttempts? }` | `{ ok: true, id }` |
| `/queue/dequeue` | `{ topic?, limit? }` | `{ messages: QueueMessage[] }` |
| `/queue/ack` | `{ id }` | `{ ok: boolean }` |
| `/queue/listen` | `{ topic }` | (no direct response — push events) |
| `/queue/unlisten` | `{ topic }` | (no response) |

Note: No `/kv/increment` endpoint — increment is a store-level operation. Use `/kv/get` + `/kv/set` or `/kv/atomic` with version checks for atomic counters.

### WebSocket Watch

Subscribe to key-change notifications.

```json
// Subscribe (client → server):
{ "id": 5, "method": "/kv/watch", "params": { "keys": [["config", "theme"], ["config", "lang"]] } }
```

**Behavior:**
1. Only ONE watcher per connection — calling again cancels the previous (calls `peer.data.watcher.cancel()`).
2. Fires **immediately** with current values for all keys on subscribe.
3. On every mutation (`set`/`delete`/`increment`/`atomic.commit`) to any watched key, fires again.
4. Fires the full set of current values for ALL watched keys (not just the changed one).
5. Errors from watcher callbacks are silently caught (store level).

**Push message format:**
```json
{
  "type": "watch",
  "entries": [
    { "key": ["config", "theme"], "value": "dark", "version": 5 },
    { "key": ["config", "lang"], "value": "en", "version": 2 }
  ]
}
```
- `entries` matches the order and length of requested `keys`. `null` for non-existent keys.

**Unwatch:**
```json
{ "id": 6, "method": "/kv/unwatch" }
```
Calls `peer.data.watcher.cancel()` and sets watcher to `undefined`.

### WebSocket Queue Listen

Push-based queue message delivery with work-stealing (round-robin).

```json
// Subscribe (client → server):
{ "id": 7, "method": "/queue/listen", "params": { "topic": "emails" } }
```
- `topic` defaults to `"default"` if omitted (`params.topic ?? "default"`).

**Behavior:**
1. One listener per topic per connection — calling again for the same topic cancels the previous via `peer.data.queueListeners.get(topic)?.cancel()`.
2. Multiple topics per connection supported simultaneously (stored in `peer.data.queueListeners` Map).
3. Messages dispatched every 1s via round-robin across all listeners for the topic (store-level).
4. Callback fires for each dequeued message. Client must `acknowledge()` manually.

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
Calls `peer.data.queueListeners.get(topic)?.cancel()` and deletes from Map.

### WebSocket Error Handling

| Scenario | Response |
|---|---|
| Unknown method (with `id`) | `{ "id": N, "error": "Unknown method: <method>" }` |
| Invalid JSON or parse failure (with `id`) | `{ "id": N, "error": "<message>" }` |
| Invalid JSON without `id` | `{ "error": "Invalid message" }` |
| Handler errors (caught) | `{ "id": N, "error": "<error message>" }` |

Error handling works via `try/catch` in the message handler:
- If JSON.parse fails or handler throws → caught in outer `catch`, returned as error response.
- If parsed JSON has no `id` (push-style) → no error response sent (client doesn't expect one).
- If method not in switch → `default` branch sends `"Unknown method"` error.

### WebSocket Connection Cleanup

On WebSocket close (via velox `close` event handler):

```ts
close(peer) {
  if (peer.data.watcher) peer.data.watcher.cancel();      // cancel active watch
  for (const handle of peer.data.queueListeners.values()) {
    handle.cancel();                                        // cancel all queue listeners
  }
}
```

1. Active watcher (if any) is canceled — removed from store's watch index.
2. All queue listeners are canceled — removed from store's listener sets. Dispatch timer may stop if no listeners remain on any connection.

---

## Internal Behavior

### Timers (from KVStore/AsyncKVStore — started in constructor, stopped on close())
- **TTL cleanup:** Every 60s — deletes rows where `expires_at <= now`
- **Failed message requeue:** Every 60s — requeues messages where `deliver_at <= now` AND `attempts < maxAttempts` AND status is not "done" (older than 30s)
- **Queue dispatch:** Every 1s — dispatches deliverable messages to active listeners (round-robin)

### Watch Internals (store level)
- `watchIndex: Map<hex-encoded-key, Set<Watcher>>`
- On mutation → `notifyWatchers(encodedKey)` fires all watchers for that key
- Each watcher re-fetches ALL watched keys' current values on every fire
- Errors from individual watcher callbacks are silently caught

### Queue Dispatch Internals (store level)
- `queueListeners: Map<topic, Set<callback>>`
- `queueRRIndex: Map<topic, number>` — round-robin index
- `dispatchToListeners()`: dequeues one message at a time, distributes round-robin
- Timer starts on first listener, stops when all topics have no listeners

### Value Serialization (store level)
- Values are stored as binary blobs with a 1-byte sentinel:
  - `0x00` = `null`, `0x01` = `true`, `0x02` = `false`
  - Everything else = `JSON.stringify` → `TextEncoder`

### Message Lifecycle
```
enqueue → pending → (dequeue by dispatch or manual) → processing
                         ↓ not acked within 30s
                      requeue → pending (up to maxAttempts)
                         ↓ ack'd
                       done (deleted)
```

---

## Route Registration Details (velox)

Routes are registered in this order:

1. `GET /health` — unprotected
2. `app.apply("/kv/*", bearerAuth({ token }))` — auth middleware for all `/kv/*`
3. All KV POST endpoints: `/kv/get`, `/kv/set`, `/kv/delete`, `/kv/list`, `/kv/atomic`, `/kv/reset`, `/kv/clean-expired`
4. Queue POST endpoints: `/queue/enqueue`, `/queue/dequeue`, `/queue/ack`
5. WebSocket: `app.ws("/ws", { upgrade, message, close })`

Auth is applied via `app.apply("/kv/*", auth)` which velox handles per-route. Queue routes do NOT have auth applied — they are registered BEFORE the auth middleware is applied (actually after, but the apply only targets `/kv/*` pattern).

Wait, in the actual code:
```ts
app.apply("/kv/*", auth);
// ... kv routes (behind auth)
// ... queue routes (NOT behind auth)
// ... ws route (handles own auth)
```

The `apply("/kv/*", bearerAuth(...))` only adds auth to routes matching `/kv/*`. Queue routes at `/queue/*` are registered after but don't match the `/kv/*` pattern, so they remain unprotected. This is noted as a gotcha.

---

## Gotchas

1. `accessToken` is required in options — no default. Auth failures return 401.
2. `createServer()` → sync store, `createAsyncServer()` → async store. Wrong pairing will cause runtime errors (sync method called as async, etc.).
3. WebSocket auth can be via query param `?token=` OR post-connect `auth` RPC. Both are supported.
4. Only ONE watcher per WebSocket connection — calling `/kv/watch` again cancels the previous.
5. Queue listeners are per-topic per-connection — calling `/queue/listen` for same topic overwrites. Multiple topics per connection OK.
6. Queue endpoints (`/queue/*`) are currently NOT behind the auth middleware (only `/kv/*` is). This may be a bug — verify before deploying to production.
7. `reset()` deletes ALL data and cancels all watchers. Not reversible.
8. The server uses velox internally — `AppServer` has `.printRoutes()` for debugging registered endpoints.
9. No `/kv/increment` endpoint — the store's `increment()` is not exposed via HTTP/WS. Use `get` + `set` or `atomic()` with version checks for atomic counters.
10. Value serialization happens at the store level (1-byte sentinel + JSON.stringify → binary blob). The server just passes values through.
11. TTL cleanup and message requeue timers run within the KVStore/AsyncKVStore instance — started in constructor, stopped on `.close()`. Not managed by the server layer.
