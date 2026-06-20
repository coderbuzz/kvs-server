<!-- docs: sync from coderbuzz/codex@cd4a13b -->

# KVS Server — AI Agent Knowledge File

**Package:** `@coderbuzz/kvs-server` v0.1.1
**Purpose:** HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`. Exposes KVStore as a network-accessible server with REST endpoints and WebSocket JSON-RPC.
**Distribution:** ESM only (`dist/index.js` + `dist/index.d.ts`).

---

## Mental Model

KVS Server is a thin server layer on top of `@coderbuzz/kvs` `KVStore`. It does NOT include the KV engine itself — users must create a `KVStore` instance and pass it to `createServer()`.

```
User code
  ├── new KVStore("kv.db")       // from @coderbuzz/kvs
  └── createServer(store, opts)  // from @coderbuzz/kvs-server
        ├── REST endpoints
        └── WebSocket RPC
```

---

## Complete Import Map

```ts
import { KVStore } from "@coderbuzz/kvs";
import { createServer, type CreateServerOptions } from "@coderbuzz/kvs-server";
```

---

## Usage

```ts
const store = new KVStore("kv.db");
const server = createServer(store, {
  port: 3000,
  hostname: "0.0.0.0",
  accessToken: "secret",
});
await server.run();
```

---

## Endpoints

All require `Authorization: Bearer <TOKEN>` (except `/health`):

- `GET /health`
- `POST /kv/get`, `/kv/set`, `/kv/delete`, `/kv/list`, `/kv/atomic`, `/kv/reset`, `/kv/clean-expired`
- `POST /queue/enqueue`, `/queue/dequeue`, `/queue/ack`

WebSocket `ws://host/ws` — same methods as JSON-RPC, plus push for watch/queue.

---

## Gotchas

1. Requires `@coderbuzz/kvs` as a dependency.
2. `accessToken` is required in options.
3. WebSocket auth via query param `?token=` or post-connect auth message.
4. `createServer()` returns a Ken `AppServer` — call `.run()` to start.
