<!-- docs: sync from coderbuzz/codex@d1487ff -->

# KVS Server: AI Agent Knowledge File

**Package:** `@coderbuzz/kvs-server`
**Purpose:** HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`. Exposes `KVStore` or `AsyncKVStore` as a network-accessible server.
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`).
**Built on:** [velox](https://github.com/coderbuzz/velox) (runtime auto-detected; `Bun.serve` on Bun) + [veta](https://github.com/coderbuzz/veta) (schema validation)
**Dependencies:** `@coderbuzz/veta` (regular). **Peer dependencies:** `@coderbuzz/kvs`, `@coderbuzz/velox`. Install: `npm install @coderbuzz/kvs @coderbuzz/velox @coderbuzz/kvs-server`.
**Runtime:** Bun ≥ 1.2.21 (`engines.bun`), because `@coderbuzz/kvs` is Bun-only (velox itself runs elsewhere too). The suite (110 tests) passes on Bun 1.2.21 and 1.4.2.

---

## Mental Model

```
Sync:  KVStore("kv.db")  +  createServer(store, opts)  →  AppServer
Async: AsyncKVStore(...) +  createAsyncServer(store, opts) →  AppServer
```

Both return a velox `AppServer`: call `.run()` to start, `.stop()` to stop, `.printRoutes()` to debug.

---

## Complete Import Map

```ts
import { KVStore, AsyncKVStore } from "@coderbuzz/kvs";
import {
  createServer,
  createAsyncServer,
  type CreateServerOptions,
  type CreateAsyncServerOptions,
  type KvsCredential,
  type KvsRole,
  type WatchHubOptions,
  type WatchHubDiagnostics,
} from "@coderbuzz/kvs-server";
```

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

## Upgrading from kvs-server 6.0

kvs-server 6.1 needs `@coderbuzz/kvs` ^0.6 (`getMany`, `atomic().sum`). Additive, no breaking change for clients:

- New `POST /kv/get-many` and WS `/kv/get-many`.
- `/kv/atomic` accepts `type: "sum"` mutations (HTTP and WS).
- `/kv/list` with `prefix` + `start`/`end` narrows inside the prefix; 6.0 answered 400 `kvs: list() takes { prefix } or { start, end }, not both`. A bound outside the prefix is still 400.
- On `createAsyncServer` with PostgreSQL, a `sum` on a non-number is a 400 like on SQLite: kvs 0.6 maps PostgreSQL's NUMERIC cast error to its own `TypeError`.
- An unknown mutation type over WS is an error with nothing written (6.0 skipped it and answered `{ ok: true }` for the rest).
- Internal: the `/kv/atomic` body schema and the mutation dispatch live in `src/atomic.ts`, shared by both servers and both transports.

## Upgrading from kvs-server 5

kvs-server 6 needs `@coderbuzz/kvs` 0.5:

- A credential scoped to a key prefix reaches the prefix key itself and its children, not a string sibling that shares its bytes (`["tenant", "a\u0000x"]` for `["tenant", "a"]`).
- `/kv/list` with `prefix` returns the children only (not the prefix key), `prefix: []` lists every key, and `prefix` with `start`/`end` is a 400.
- Entry versions are store-wide versionstamps, not 1, 2, 3 per key.
- A key over 2 KiB encoded, `NaN` in a key, or a value kvs cannot store is a `400`.
- A stored `bigint` is sent as a decimal string (it used to be impossible to store; JSON has no bigint). `Date`, `Map`, `Set` and `Uint8Array` values go out as `JSON.stringify` writes them.

## Upgrading from kvs-server 4

kvs-server 5 needs `@coderbuzz/kvs` 0.4. The queue protocol changed:

- `/queue/ack` takes `{ id, token }`; `token` comes with every dequeued or pushed message.
- A WebSocket listener pushes at most `concurrency` (default 1) messages until they are acked or nacked. kvs-server 4 pushed and forgot, so every message was out at once and nothing was retried until the store's timer.
- New routes: `/queue/nack`, `/queue/extend`, `/queue/dead`, `/queue/retry-dead`, `/queue/delete-dead`, `/queue/stats`.
- A topic-scoped queue credential can now ack (with the token).
- A body that fails its schema is a `400`, not a `500`.


## `createServer(store, options): AppServer`

Creates an HTTP server wrapping a sync `KVStore`.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `KVStore` | required | Sync store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |
| `options.readToken` | `string` | none | Read/list/watch credential |
| `options.writeToken` | `string` | none | Read/write/atomic/queue-enqueue credential |
| `options.adminToken` | `string` | none | Administrative credential |
| `options.credentials` | `KvsCredential[]` | `[]` | Additional role/scoped credentials |
| `options.legacyAccessTokenRole` | `"read" \| "write" \| "queue" \| "admin"` | `"admin"` | Role assigned to legacy access token |
| `options.allowQueryToken` | `boolean` | `true` | Deprecated WS query-token compatibility |
| `options.maxPayloadLength` | `number` | `4_194_304` | Inbound WS frame bytes |
| `options.authTimeoutMs` | `number` | `5000` | Post-connect auth deadline |
| `options.watch` | `WatchHubOptions` | defaults below | Grouping/backpressure policy |

Returns a velox `AppServer` with methods: `.run()`, `.stop()`, `.printRoutes()`.

## `createAsyncServer(store, options): AppServer`

Same as `createServer` but wraps an async `AsyncKVStore`. All store calls are awaited internally.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `AsyncKVStore` | required | Async store instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |
| other options | | | Every other `CreateServerOptions` field applies unchanged (`CreateAsyncServerOptions` has the same shape) |

### Roles and credentials

```ts
type KvsRole = "read" | "write" | "queue" | "admin";
interface KvsCredential {
  token: string;
  role: KvsRole;
  keyPrefixes?: KvKey[];   // omit = every key
  queueTopics?: string[];  // omit = every topic
  principalId?: string;
}
interface WatchHubOptions {
  maxWatchKeys?: number;        // 32
  maxEventBytes?: number;       // 2 MiB
  softBufferBytes?: number;     // 2 MiB
  hardBufferBytes?: number;     // 4 MiB, also the WS backpressureLimit
  slowConsumerGraceMs?: number; // 15000
}
```

| Role | Allowed actions |
|---|---|
| `read` | get, list, watch |
| `write` | get, list, watch, set, delete, atomic, queue-enqueue |
| `queue` | queue-enqueue, queue-dequeue, queue-ack (ack/nack/extend), queue-listen, queue-dead (dead/retry-dead/delete-dead), queue-stats |
| `admin` | everything, including reset, clean-expired, watch-stats |

- `accessToken`, `readToken`, `writeToken`, `adminToken`, and `credentials[]` are merged into one token map. Empty or duplicate tokens throw at construction.
- Key scopes compare encoded keys (`withinPrefix` in `auth.ts`): a key is inside a scope when its encoding equals the scope's, or starts with it followed by a key-part type byte 1..6, the same range `list({ prefix })` reads. kvs-server 5 compared raw byte prefixes, so `["tenant", "a\u0000x"]` passed for a scope `["tenant", "a"]` (KVS-16). A scoped `/kv/list` must pass a `prefix` inside an allowed prefix (`start`/`end` ranges are denied).
- Scoped queue credentials (`queueTopics` set) may ack/nack/extend: the lease token proves the message came from an allowed topic. They must pass `topic` to `/queue/stats`.
- `softBufferBytes > hardBufferBytes` throws at construction.

---

## HTTP Endpoints

All endpoints except `GET /health` require `Authorization: Bearer <TOKEN>`.
Bearer middleware protects both `/kv/*` and `/queue/*`; every handler then
authorizes its action, all atomic keys, encoded key prefixes, and queue topics.
Missing/unknown token → `401` with a plain-text body from velox `bearerAuth`. Known token without permission → `403` `{ "error": "Forbidden", "reason": "..." }`. Body validation failures are rejected by veta before the handler runs and answered `400 { "error": "Bad Request", "reason" }` (a 500 before kvs-server 5).
`accessToken` remains admin by default for compatibility. Use
`legacyAccessTokenRole: "write"`, a separate `adminToken`, and read/scoped
credentials during migration.

### Health

```
GET /health
```
- **Auth:** No auth required
- **Response:** `{ "ok": true, "uptime": 123.456 }` (uptime in seconds from `process.uptime()`)

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

#### `POST /kv/get-many`

```json
// Request
{ "keys": [["users", "alice"], ["users", "nobody"], ["settings", "alice"]] }

// Response: one slot per key, in request order
{ "entries": [
  { "key": ["users", "alice"], "value": { "name": "Alice" }, "version": 1843 },
  null,
  { "key": ["settings", "alice"], "value": { "theme": "dark" }, "version": 1790 }
] }
```
- Validated by veta: `keys` → `array(kvKey)` (no minimum: `[]` answers `{ "entries": [] }`; an empty key `[]` inside is a 400).
- Authorization: action `get` over every key (`read`, `write` and `admin` roles). A scoped credential with any key outside its prefixes gets `403 { "error": "Forbidden", "reason": "key is outside the allowed prefixes" }` before anything is read, so the response never mixes allowed and denied keys.
- Store errors are 400 with `reason`: more than 1000 keys (`kvs: getMany() reads at most 1000 keys, got N`), a key over `maxKeySize`.
- `createServer` reads the keys in one SQLite read transaction; `createAsyncServer` in one `SELECT ... WHERE key IN (...)` (one snapshot on both).
- Values go out through the same bigint-safe JSON as `/kv/get`.

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
// Request: prefix
{ "prefix": ["users"] }

// Request: range
{ "start": ["events", 1000], "end": ["events", 2000] }

// Request: a range inside a prefix (kvs 0.6): start inclusive, end exclusive
{ "prefix": ["orders"], "start": ["orders", "2026-09"], "end": ["orders", "2026-10"] }

// Request: paginated
{ "prefix": ["logs"], "limit": 20, "cursor": "Abc..." }

// Request: reverse
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
- `400 { "error": "Bad Request", "reason": "kvs: ..." }` when kvs rejects the options: a `cursor` outside the requested `prefix`/range (a scoped credential cannot page out of its prefix with a forged cursor), or a `limit` that is not an integer ≥ 1 (e.g. `2.5`). Before this release, with kvs ≤ 0.3.1, the forged cursor returned other prefixes' entries with 200, and `limit: 2.5` was a 500. Over WS RPC the same case replies `{ "id": n, "error": "RangeError: kvs: ..." }`.
- `prefix` + `start`/`end`: each bound must be a child of `prefix`, else `400` with `reason: "kvs: list() start must be a key inside the prefix"` (or `end`); over WS `{ "id": n, "error": "TypeError: kvs: list() start must be a key inside the prefix" }`. Scoped credentials are authorized on `prefix` alone (it must be inside an allowed prefix); the bound rule then keeps the whole range inside `prefix`, so `{ "prefix": ["tenant", "a"], "start": ["tenant", "b"] }` is a 400 and never returns tenant b's rows (tested for sync and async servers, HTTP and WS).
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
    { "type": "sum", "key": ["stats", "updates"], "value": 1 },
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
- `sum` (kvs 0.6): `value` is the delta. Semantics are the store's `atomic().sum()` (missing/expired → delta without TTL, live key keeps its TTL, sees earlier mutations of the same request). Errors, all `400` with nothing written: stored non-number → `reason: "kvs: atomic().sum() needs a number, but the key holds string"` (PostgreSQL: `... holds a non-numeric value`); `value` missing, `null`, a string or not finite → `reason: "kvs: atomic().sum() delta must be a finite number, got X"`. Over WS the same text comes back as `{ "id": n, "error": "TypeError: kvs: ..." }` / `"RangeError: ..."`. Authorization: its key counts as an `atomic` key (write roles, key scopes).
- An unknown mutation type: REST 400 from the schema; WS `{ "id": n, "error": "TypeError: kvs-server: unknown mutation type \"min\" (set, delete or sum)" }`, checked before anything is added to the commit, so nothing is written. kvs-server 6.0 skipped it over WS and committed the other mutations with `{ ok: true }`.
- Validation: `checks` → `array(object({ key: kvKey, version: nullable(number) }))`, `mutations` → `array(object({ type: union([literal("set"), literal("delete"), literal("sum")]), key: kvKey, value: optional(unknown), ttl: optional(number({ min: 0 })) }))`, `enqueues` → `array(object({ payload: unknown, options: optional(object({ topic: optional(string), delay: optional(number({ min: 0 })), maxAttempts: optional(number({ min: 1 })) })) }))`.

#### `POST /kv/reset`

```json
// Request
{}

// Response
{ "ok": true }
```
Deletes ALL data from `kv` and `queue` tables. Admin-only. Watchers receive
`null` entries with `reset: true` and remain registered.

#### `POST /kv/clean-expired`

```json
// Request
{}

// Response
{ "ok": true, "deleted": 42 }
```
Manually delete expired KV entries. Returns count of removed rows. (Auto-runs every 60s on server.) Admin-only. Expired keys are pushed to watchers as `null` tombstones.

#### `POST /kv/watch-stats`

```json
// Request
{}

// Response
{
  "store": { "activeWatchers": 1, "committedBatches": 10, "callbacks": 12, "sharedReads": 0, "callbackErrors": 0, "dispatchErrors": 0 },
  "server": { "groups": 1, "peers": 3, "serializations": 11, "sends": 33, "backpressureEvents": 0, "coalescedEvents": 0, "droppedEvents": 0, "slowConsumerCloses": 0 },
  "queue": { "listeners": 2, "inFlight": 1, "delivered": 40, "acked": 38, "nacked": 1, "handlerErrors": 0, "leaseLost": 0, "dispatchErrors": 0 }
}
```
Admin-only (`diagnostics` action). `store` is `KvWatchDiagnostics`, `server` is `WatchHubDiagnostics`, `queue` is `KvQueueDiagnostics` (listeners of this server's store, WebSocket ones included).

### Queue Endpoints (all POST)

A dequeued message is **leased**: it carries a `token`, and only that token can
ack, nack or extend it. If it is neither acked nor nacked before `lockedUntil`,
it is delivered again; after `maxAttempts` deliveries it is dead-lettered. Invalid
arguments (a fractional `limit`, `maxAttempts: 0`, an empty token) are a `400`.

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
- `topic` default: `"default"`, `delay` default: `0`, `maxAttempts` default: `3` (integer >= 1).

#### `POST /queue/dequeue`

```json
// Request
{ "topic": "emails", "limit": 10, "visibilityTimeout": 60000 }

// Response
{
  "messages": [
    {
      "id": 1,
      "topic": "emails",
      "payload": { "to": "user@example.com" },
      "enqueuedAt": 1700000000000,
      "deliverAt": 1700000005000,
      "attempts": 1,
      "maxAttempts": 5,
      "token": "3f0c6c1e-8a1d-4a51-9a53-2b6f4c7d9e10",
      "lockedUntil": 1700000035000,
      "lastError": null
    }
  ]
}
```
- `topic` default: `"default"`, `limit` default: `1` (max 1000), `visibilityTimeout` default: the store's (30 s).

#### `POST /queue/ack`

```json
{ "id": 1, "token": "3f0c6c1e-..." }   →   { "ok": true }
```
Deletes the message (or keeps it as `done` under the store's `doneRetention`). `"ok": false` when the lease is no longer held under that token.

#### `POST /queue/nack`

```json
{ "id": 1, "token": "3f0c6c1e-...", "error": "SMTP 451", "delay": 10000 }   →   { "ok": true }
```
Retry after `delay` ms (default: the store's backoff), or dead-letter on the last attempt. `error` becomes `lastError`.

#### `POST /queue/extend`

```json
{ "id": 1, "token": "3f0c6c1e-...", "visibilityTimeout": 60000 }   →   { "ok": true }
```
The lease now ends `visibilityTimeout` ms from now; `0` hands the message back.

#### `POST /queue/dead`, `/queue/retry-dead`, `/queue/delete-dead`

```json
{ "topic": "emails", "limit": 100, "after": 0 }   →   { "messages": [{ "id": 1, …, "lastError": "SMTP 451", "failedAt": 1700000100000 }] }
{ "topic": "emails", "id": 1 }                    →   { "count": 1 }      // omit id: every dead message of the topic
```

#### `POST /queue/stats`

```json
{ "topic": "emails" }   →   { "stats": [{ "topic": "emails", "pending": 3, "delayed": 1, "processing": 2, "dead": 0, "done": 0, "oldestPendingAt": 1700000000000 }] }
```
Omit `topic` for every topic (unscoped credentials only).

**Authorization.** `ack`, `nack` and `extend` need the `queue-ack` action but no topic check: the lease token is only handed out by a dequeue from an allowed topic (0.3 refused every ack from a topic-scoped credential). `dead`, `retry-dead` and `delete-dead` are the `queue-dead` action and `stats` is `queue-stats`, both topic-checked; a scoped credential must name a topic for `stats`.

**Validation.** The REST bodies go through veta; a body that fails its schema is a `400 { "error": "Bad Request", "reason": "<veta message>" }` (0.3 answered every schema failure with a 500). kvs's own `RangeError`/`TypeError` whose message starts with `"kvs: "` (a key over `maxKeySize`, `NaN` in a key, an unsupported value, `prefix` with `start`, `limit: 1.5`) are mapped to the same 400 on every route by `mapValidationErrors` (`isKvsInputError`); any other error stays velox's logged 500.

**Values on the wire.** Responses that carry stored values go through `json()`/`stringify()` (`src/errors.ts`): plain `JSON.stringify` first, and only if it throws a `TypeError` (a bigint) again with a replacer that writes bigints as decimal strings. Watch pushes and WS results use the same `stringify`. Other kvs 0.5 typed values take their `JSON.stringify` form (Date → ISO string, Map/Set → `{}`, Uint8Array → `{"0":…}`, undefined dropped, NaN → null); keep such values to the local store API or convert them yourself.

---

## WebSocket Protocol

**Endpoint:** `ws://host:port/ws`

Uses JSON-RPC format. All methods mirror their REST counterparts.

**KVS WebSocket defaults:**
- `maxPayloadLength`: 4 MiB (`options.maxPayloadLength`)
- `backpressureLimit`: 4 MiB (`options.watch.hardBufferBytes`)
- `closeOnBackpressureLimit`: true
- `pingInterval`: 30 s
- `pongTimeout`: 10 s
- `idleTimeout`: 120 s
- `perMessageDeflate`: disabled

### Auth (Required before any RPC call)

Two modes:

**Mode 1: Query parameter (deprecated compatibility mode)**
```
ws://host:port/ws?token=ACCESS_TOKEN
```
- If token matches → connection upgraded with the resolved principal
- If token wrong → rejected with HTTP 401 `"Unauthorized"`
- If `allowQueryToken: false` and `?token=` is present → HTTP 401 `"Query token authentication is disabled"`
- If no `?token=` → connection must authenticate through Mode 2 before `authTimeoutMs` (default 5000), otherwise closed with code 4001 reason `"authentication_timeout"`

**Mode 2: Post-connect RPC auth**
```json
// Client sends (must be first message after connect):
{ "id": 1, "method": "auth", "params": { "token": "ACCESS_TOKEN" } }

// Server responds:
{ "id": 1, "result": { "ok": true } }
```
- If wrong token → `{ "id": 1, "error": "Unauthorized" }` + connection closed (code 4001, reason `"Unauthorized"`)
- If any non-auth method sent before auth → `{ "id": 1, "error": "Unauthorized" }` + connection closed (code 4001)
- After auth, every method is checked by `authorizeRpc()`. A denial replies `{ "id": N, "error": "Forbidden: <reason>" }` and keeps the socket open.

**Peer data shape:**
```ts
{
  principal: AuthPrincipal | null
  queue: {
    queueListeners: Map<string, { cancel(): Promise<void> }>  // topic → store listener
    deliveries: Set<string>                                   // "id:token" pushed, not yet settled
  }
  authTimer: ReturnType<typeof setTimeout> | null
}
```
Unauthenticated sockets have 5 seconds by default to complete `auth`. Query
tokens can be disabled with `allowQueryToken: false` and should be disabled in
production to avoid URL logging.

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

**Server → Client (push: unsolicited, no `id`):**
```json
{ "type": "watch", "entries": [...], "sequence": 42 }
{ "type": "queue", "topic": "...", "message": {...} }
```
The watch push is built as `{ type, entries, sequence, reset: event.reset || undefined }`, so `reset` appears only as `true` on reset tombstones. `initial`, `changedKeys`, and `coalesced` from the core `KvWatchEvent` are not sent.

### All RPC Methods

| Method | Parameters | Result |
|---|---|---|
| `auth` | `{ token: string }` | `{ ok: true }` |
| `/kv/get` | `{ key: KvKey }` | `{ entry: KvEntry \| null }` |
| `/kv/get-many` | `{ keys: KvKey[] }` (max 1000; not an array → `Forbidden: keys must be an array of keys`) | `{ entries: (KvEntry \| null)[] }` |
| `/kv/set` | `{ key, value, ttl? }` | `KvCommitResult` |
| `/kv/delete` | `{ key }` | `{ ok: true }` |
| `/kv/list` | `{ prefix?, start?, end?, limit?, cursor?, reverse? }` | `KvListResult` |
| `/kv/atomic` | `{ checks?, mutations?, enqueues? }` (mutation `type`: `set`, `delete`, `sum`) | `KvCommitResult \| { ok: false }` |
| `/kv/reset` | `{}` | `{ ok: true }` |
| `/kv/clean-expired` | `{}` | `{ ok: true, deleted }` |
| `/kv/watch` | `{ keys: KvKey[] }` | (no direct response, push events) |
| `/kv/unwatch` | `{}` | (no response) |
| `/queue/enqueue` | `{ payload, topic?, delay?, maxAttempts? }` | `{ ok: true, id }` |
| `/queue/dequeue` | `{ topic?, limit?, visibilityTimeout? }` | `{ messages: QueueMessage[] }` |
| `/queue/ack` | `{ id, token }` | `{ ok: boolean }` |
| `/queue/nack` | `{ id, token, error?, delay? }` | `{ ok: boolean }` |
| `/queue/extend` | `{ id, token, visibilityTimeout? }` | `{ ok: boolean }` |
| `/queue/dead` | `{ topic?, limit?, after? }` | `{ messages: QueueDeadMessage[] }` |
| `/queue/retry-dead` | `{ topic?, id? }` | `{ count }` |
| `/queue/delete-dead` | `{ topic?, id? }` | `{ count }` |
| `/queue/stats` | `{ topic? }` | `{ stats: QueueStats[] }` |
| `/queue/listen` | `{ topic?, concurrency?, visibilityTimeout? }` (topic default `"default"`) | (no response, push events follow) |
| `/queue/unlisten` | `{ topic? }` | (no response) |
| `/debug/watch-stats` | `{}` | `{ store: KvWatchDiagnostics, server: WatchHubDiagnostics, queue: KvQueueDiagnostics }` (admin) |

WS RPC params are not schema-validated (only REST bodies go through veta). Invalid params surface as handler errors.

Note: No `/kv/increment` endpoint. Use a `sum` mutation in `/kv/atomic` (kvs 0.6): atomic on every backend, no read, no version check. The reply is `{ ok, version }`, not the new value.

### WebSocket Watch

Subscribe to key-change notifications.

```json
// Subscribe (client → server):
{ "id": 5, "method": "/kv/watch", "params": { "keys": [["config", "theme"], ["config", "lang"]] } }
```

**Behavior:**
1. Only one watch per connection; re-watch removes the peer from its old group.
2. `groupsBySignature` is keyed by ordered encoded keys, so identical
   subscriptions share one `store.watch()` handle and cached initial/live payload.
3. The first store callback performs one `JSON.stringify`; joining peers reuse
   the immutable cached string. A mutation performs one serialization per group
   and exactly one send attempt per peer.
4. Atomic multi-key commits arrive once because the store emits one committed
   batch. Expiry/reset produce tombstones; reset preserves the group.
5. `sequence` is monotonic within the store process only. It is not a durable
   replay cursor and may restart after process recovery.
6. Send policy uses actual UTF-8 event bytes and `peer.getBufferedAmount()`.
   `-1` means the current event entered the native queue, so it is not retried.
   While blocked, only the newest later payload is retained and resumed on
   `drain` or a bounded buffer poll.
7. Default limits: 32 keys/watch, 2 MiB event, 2 MiB soft buffer, 4 MiB hard
   buffer, 15 s grace. Code `4008` means slow consumer; `4009` means oversized
   event; `1011` means `send()` returned 0 (dropped). Every value is configurable
   through `options.watch`.
8. An empty `keys` array or more than `maxWatchKeys` keys throws inside the
   handler. Because the error reply carries the request `id`, a client that sends
   `/kv/watch` without an `id` (as `@coderbuzz/kvs-client` does) receives only
   `{ "error": "Invalid message" }` and no push events. A `Forbidden` denial for an
   `id`-less watch is sent as `{ "error": "Forbidden: ..." }`.
9. A peer that joins an existing group receives the group's cached payload
   immediately. If the group's first snapshot has not arrived yet (async store),
   the peer gets it with the rest of the group.

**Push message format:**
```json
{
  "type": "watch",
  "entries": [
    { "key": ["config", "theme"], "value": "dark", "version": 5 },
    { "key": ["config", "lang"], "value": "en", "version": 2 }
  ],
  "sequence": 7
}
```
- `entries` matches the order and length of requested `keys`. `null` for non-existent keys.

**Unwatch:**
```json
{ "id": 6, "method": "/kv/unwatch" }
```
Removes the peer from its WatchHub group. The group cancels its store handle and
drops its cached payload when the last peer leaves.

### WebSocket Queue Listen

```json
// Subscribe (client → server):
{ "id": 7, "method": "/queue/listen", "params": { "topic": "emails", "concurrency": 4, "visibilityTimeout": 60000 } }
```
- `topic` defaults to `"default"`; `concurrency` (integer 1..1000, default 1) and `visibilityTimeout` are passed to the store listener, which validates them (an invalid value is an RPC error).

**Behavior:**
- One listener per topic per connection. Calling again for same topic replaces it.
- Multiple topics per connection supported simultaneously.
- The server pushes at most `concurrency` (default 1, max 1000) messages and then **waits**: a slot frees when the client acks or nacks the message (over this socket or HTTP), when its lease ends, or when the connection closes. `@coderbuzz/kvs-client` acks when the handler resolves and nacks when it throws.
- Listeners on other connections (and other processes on the same database) share the topic: whoever has a free slot gets the next message.
- New messages are pushed at once, including ones from `/kv/atomic`; delayed messages, retries and expired leases within a second.
- Closing the connection hands its unacked messages back at once (their leases are released), so another listener gets them.

**Implementation (`src/queue-routes.ts`, `QueueBridge`):**
1. `/queue/listen` calls `store.addQueueListener(topic, handler, { concurrency, visibilityTimeout, autoAck: false })` and keeps the handle in `peer.data.queue.queueListeners` (a second listen for the topic cancels the first).
2. The handler returns a promise and sends `{ type: "queue", topic, message }`. The promise is stored in a server-wide `Map<"id:token", Delivery>` (and the key in `peer.data.queue.deliveries`) and resolves on: a successful `/queue/ack` or `/queue/nack` with that id+token over any transport; a successful `/queue/extend` with `visibilityTimeout: 0`; a timer at `lockedUntil` (re-armed by `/queue/extend`, whose default length for a pushed message is that delivery's own lease length); the connection closing. While it is pending the store listener holds the slot, so the server never has more than `concurrency` unacked messages out per listener.
3. `autoAck: false` means the store neither acks nor renews: the client owns the lease (`/queue/extend` for long jobs).
4. On close: listeners cancelled, each unsettled delivery resolved and its lease released with `extendLease(id, token, 0)`, so the next dequeue (this store: at once; other processes: within 1 s) delivers it again with `attempts + 1`.

**Push message format:**
```json
{
  "type": "queue",
  "topic": "emails",
  "message": {
    "id": 1, "topic": "emails", "payload": { "to": "user@example.com" },
    "enqueuedAt": 1700000000000, "deliverAt": 1700000000000,
    "attempts": 1, "maxAttempts": 3,
    "token": "3f0c6c1e-8a1d-4a51-9a53-2b6f4c7d9e10", "lockedUntil": 1700000030000, "lastError": null
  }
}
```

**Unlisten:**
```json
{ "id": 8, "method": "/queue/unlisten", "params": { "topic": "emails" } }
```
Cancels the store listener (already pushed messages stay leased until acked, nacked or expired).

### WebSocket Error Handling

| Scenario | Response |
|---|---|
| Unknown method (with `id`) | `{ "id": N, "error": "Unknown method: <method>" }` |
| Invalid JSON or parse failure (with `id`) | `{ "id": N, "error": "<message>" }` |
| Invalid JSON without `id` | `{ "error": "Invalid message" }` |
| Handler errors (caught) | `{ "id": N, "error": "<error message>" }` |
| Authorization denied | `{ "id": N, "error": "Forbidden: <reason>" }` |

Error handling works via `try/catch` in the message handler:
- If JSON.parse fails or handler throws → caught in outer `catch`. With an `id` → `{ id, error: String(err) }`; without an `id` → `{ "error": "Invalid message" }`.
- If method not in switch → `default` branch sends `"Unknown method"` error only when `id` is present; otherwise nothing is sent.

### WebSocket Connection Cleanup

On WebSocket close (via velox `close` event handler):

```ts
close(peer) {
  if (peer.data.authTimer) clearTimeout(peer.data.authTimer);
  watchHub.close(peer);          // remove grouped watch peer
  queue.close(peer.data.queue);  // cancel listeners, release unacked leases
}
```

1. Peer is removed from WatchHub; an empty group cancels its one store watcher.
2. All queue listeners are canceled; messages pushed to this peer and not settled are released (`extendLease(…, 0)`).

---

## Internal Behavior

### Timers (from KVStore/AsyncKVStore, stopped on close())
- `KVStore` starts its 60s timer in the constructor; `AsyncKVStore` starts it after the first operation.
- **TTL cleanup + queue maintenance:** every 60s: deletes rows where `expires_at <= now` (tombstones), dead-letters leases that expired on their last attempt, applies `doneRetention`/`deadRetention`.
- **Lease reclaim:** before a dequeue, at most once a second per store: expired leases with attempts left → pending.
- **Listener poll:** every 1s while listeners exist (WebSocket listeners included).
- **Per delivery (server):** one timeout at the message's `lockedUntil` that frees the WebSocket slot.

### Watch Internals (store level)
- `watchIndex: Map<hex-encoded-key, Set<Watcher>>`
- Store committed batches deduplicate matching watchers and share unchanged-key reads.
- WatchHub groups identical ordered subscriptions and serializes once per group.
- Peer sends are independent and every send result participates in backpressure policy.

### Queue Dispatch Internals (store level)
- One `QueueWorker` per listener (`@coderbuzz/kvs` `src/queue.ts`): dequeues only while it has a free slot, awaits the handler, notified by enqueue/atomic/retry-dead, a finished handler and the 1 s poll. No round-robin; listeners compete for messages.

### Value Serialization (store level)
- Values are stored as binary blobs with a 1-byte sentinel:
  - `0x00` = `null`, `0x01` = `true`, `0x02` = `false`
  - Everything else = `JSON.stringify` → `TextEncoder`

### Message Lifecycle
```
enqueue → pending → (dequeue / push, lease + token) → processing
   ▲                    │ ack(id, token) → row deleted (status 'done' kept only under doneRetention)
   ├── nack, attempts < max → pending at now + backoff
   ├── lease expired, attempts < max → pending (reclaimed before a dequeue)
   │                    │ nack / lease expiry on the last attempt → dead (lastError, failedAt)
   └──────── retry-dead ┘
```

---

## Route Registration Details (velox)

Routes are registered in this order:

0. `mapValidationErrors(app)` (`src/errors.ts`): `app.onError` answers a `VetaError` with 400 and rethrows everything else to velox's default (logged 500, no error text in the body)
1. `GET /health`: unprotected
2. `app.apply("/kv/*", auth)` and `app.apply("/queue/*", auth)`, where `auth = { auth: bearerAuth({ token: verifier.tokens }) }`
3. KV POST endpoints: `/kv/get`, `/kv/get-many`, `/kv/set`, `/kv/delete`, `/kv/list`, `/kv/atomic` (body schemas of `/kv/get-many` and `/kv/atomic` and the mutation dispatch `buildAtomic()` in `src/atomic.ts`)
4. Queue POST endpoints: `/queue/enqueue` (route file), then `registerQueueRoutes()` from `queue-routes.ts`: `/queue/dequeue`, `/queue/ack`, `/queue/nack`, `/queue/extend`, `/queue/dead`, `/queue/retry-dead`, `/queue/delete-dead`, `/queue/stats`
5. Admin KV POST endpoints: `/kv/reset`, `/kv/clean-expired`, `/kv/watch-stats`
6. WebSocket: `app.ws("/ws", { upgrade, open, message, drain, close }, { maxPayloadLength, backpressureLimit, closeOnBackpressureLimit: true })`

```ts
app.apply("/kv/*", auth);
app.apply("/queue/*", auth);
// ... kv and queue routes, each with per-action/key/topic authorization
// ... ws route (handles its own auth)
```

Both route families use the same configured credential set. Do not remove the
per-handler authorization check: bearer middleware establishes identity, while
the handler verifies role, key scope, atomic contents, and queue topic.

---

## Benchmarks and Watch Harness

Transport overhead vs direct `KVStore` (Apple M-series, Bun; source: github.com/coderbuzz/benchmarks):

| Scenario | KVS direct | WS RPC | HTTP REST |
|---|---|---|---|
| set('k','v') | 158,732 ops/s | 53,999 ops/s (2.9x) | 19,433 ops/s (8.2x) |
| get('k'), hit | 1,160,021 ops/s | 55,723 ops/s (20.8x) | 24,973 ops/s (46.4x) |

Real-socket fan-out harness (`bench/watch-fanout.ts`, script `bench:watch`), run against a separately started server:

```sh
bun run --cwd packages/kvs-server bench:watch -- \
  --url http://127.0.0.1:3000 --token TOKEN \
  --clients 5000 --channels 1 --payload-bytes 100000 --updates 3
```

`--url` and `--token` are required; `--clients` (1000), `--channels` (1), `--payload-bytes` (100000), `--updates` (3), and `--timeout-ms` (120000) are optional. It opens authenticated WebSockets, publishes through REST, and reports connection time, p50/p95/p99/last delivery latency, runtime metadata, and the `/kv/watch-stats` counters. It needs an admin-capable token for `/kv/watch-stats`.

---

## Gotchas

1. `accessToken` is required in options. No default. Unknown tokens return 401; known tokens without permission return 403.
2. `createServer()` → sync store, `createAsyncServer()` → async store. Wrong pairing will cause runtime errors (sync method called as async, etc.).
3. WebSocket auth can be via query param `?token=` OR post-connect `auth` RPC. Both are supported.
4. Only ONE watcher per WebSocket connection. Calling `/kv/watch` again cancels the previous.
5. Queue listeners are per-topic per-connection. Calling `/queue/listen` for same topic overwrites. Multiple topics per connection OK.
6. Queue endpoints require auth. ack/nack/extend need the lease token (`400` without it); a wrong or stale token is `{ ok: false }`, not an error.
7. `reset()` is admin-only, deletes ALL data, emits reset tombstones, and is not reversible.
8. The server uses velox internally: `AppServer` has `.printRoutes()` for debugging registered endpoints.
9. No `/kv/increment` endpoint. The store's `increment()` is not exposed via HTTP/WS; a `sum` mutation in `/kv/atomic` does the same inside a commit (kvs-server 6.1).
10. Value serialization happens at the store level (1-byte sentinel + JSON.stringify → binary blob). The server just passes values through.
11. TTL cleanup and queue maintenance timers run within the KVStore/AsyncKVStore instance (`KVStore`: started in constructor; `AsyncKVStore`: started on first operation), stopped on `.close()`. Not managed by the server layer.
12. Neither `createServer` nor `app.stop()` closes the store or the WatchHub; close the store yourself on shutdown.
13. `@coderbuzz/velox` is a peer dependency: install it next to `@coderbuzz/kvs`.
14. kvs-server 5 needs `@coderbuzz/kvs` ^0.4 (queue v2 store API). A 0.3 store has no `nack`/`listDead`/`queueStats`.
15. A WebSocket listener with the default `concurrency: 1` processes one message at a time per connection. Raise it for throughput; the client must ack or nack every pushed message, or its slot stays taken until the lease ends.
16. WS RPC params are not schema-validated; kvs validates the queue arguments itself and the error comes back as `{ id, error }`.
17. kvs-server 6 needs `@coderbuzz/kvs` ^0.5 (versionstamps, typed values, prefix semantics).
18. `list` with `prefix` no longer returns the prefix key itself; a scoped credential for `["tenant", "a"]` still reads `["tenant", "a"]` with `/kv/get`.
19. kvs-server 6.1 needs `@coderbuzz/kvs` ^0.6: a 0.5 store has no `getMany`/`sum` (the route would throw `is not a function`, a 500).
20. `/kv/get-many` is all-or-nothing on authorization: one key outside a scoped credential's prefixes denies the whole call (403). Split the keys per scope on the client.
