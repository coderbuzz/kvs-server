<!-- docs: sync from coderbuzz/codex@5f93304 -->

# KVS Server — AI Agent Knowledge File

**Package:** `@coderbuzz/kvs-server` v0.1.9
**Purpose:** HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`. Exposes KVStore or AsyncKVStore as a network-accessible server.
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`).

---

## Mental Model

```
Sync:  KVStore("kv.db")  +  createServer(store, opts)
Async: AsyncKVStore(...) +  createAsyncServer(store, opts)
```

---

## Complete Import Map

```ts
import { KVStore, AsyncKVStore } from "@coderbuzz/kvs";
import { createServer, createAsyncServer, type CreateServerOptions, type CreateAsyncServerOptions } from "@coderbuzz/kvs-server";
```

---

## Usage

```ts
// Sync
const store = new KVStore("kv.db");
const server = createServer(store, { port: 3000, accessToken: "secret" });
await server.run();

// Async (PostgreSQL)
const asyncStore = new AsyncKVStore("postgres://user:pass@localhost:5432/kvdb");
const asyncServer = createAsyncServer(asyncStore, { port: 3001, accessToken: "secret" });
await asyncServer.run();
```

---

## Endpoints

Both servers expose the same endpoints:

- `GET /health` (unauthenticated)
- `POST /kv/get`, `/kv/set`, `/kv/delete`, `/kv/list`, `/kv/atomic`, `/kv/reset`, `/kv/clean-expired`
- `POST /queue/enqueue`, `/queue/dequeue`, `/queue/ack`
- WebSocket `ws://host/ws` — JSON-RPC + push for watch/queue

---

## Gotchas

1. `accessToken` is required in options.
2. `createServer()` → sync store, `createAsyncServer()` → async store.
3. WebSocket auth via query param `?token=` or post-connect auth message.
4. Both return a Ken `AppServer` — call `.run()` to start.
