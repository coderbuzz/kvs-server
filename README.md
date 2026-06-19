<!-- docs: sync from coderbuzz/codex@cb90530 -->

# KVS Server &mdash; `@coderbuzz/kvs-server`

> **HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`.** Expose your KV store as a full-featured HTTP API with WebSocket RPC, watch, and push-based queue listeners.
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/kvs-server/blob/main/AI_KNOWLEDGE.md) for expert context.

KVS Server wraps `@coderbuzz/kvs` `KVStore` into a production-ready HTTP server with REST endpoints and a WebSocket JSON-RPC interface. It handles authentication, routing, WebSocket upgrade, and protocol translation.

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
- **WebSocket watch** — real-time key-change subscriptions
- **Push-based queue** — work-stealing distribution across connected listeners
- **Health checks** — unauthenticated `/health` endpoint

---

## Installation

```sh
npm install @coderbuzz/kvs @coderbuzz/kvs-server
```

KVS Server requires `@coderbuzz/kvs` as a peer (the store engine).

---

## Quick Start

```ts
import { KVStore } from "@coderbuzz/kvs";
import { createServer } from "@coderbuzz/kvs-server";

const store = new KVStore("kv.db");
const server = createServer(store, {
  port: 3000,
  hostname: "0.0.0.0",
  accessToken: "your-secret-token",
});

server.printRoutes();
const { hostname, port } = await server.run();
console.log(`KVS listening on ${hostname}:${port}`);
```

### Graceful Shutdown

```ts
process.on("SIGINT", () => {
  store.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  store.close();
  process.exit(0);
});
```

---

## API

### `createServer(store, options): AppServer`

Creates an HTTP server with REST + WebSocket endpoints.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `KVStore` | required | An instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

Returns a Ken `AppServer` instance.

---

## HTTP Endpoints

All endpoints except `/health` require: `Authorization: Bearer <ACCESS_TOKEN>`

### Health

```
GET /health
```

### KV (all POST)

| Endpoint | Body | Response |
|---|---|---|
| `/kv/get` | `{ key }` | `{ entry }` or `{ entry: null }` |
| `/kv/set` | `{ key, value, ttl? }` | `{ ok, version }` |
| `/kv/delete` | `{ key }` | `{ ok }` |
| `/kv/list` | `{ prefix?, start?, end?, limit?, cursor?, reverse? }` | `{ entries, cursor }` |
| `/kv/atomic` | `{ checks?, mutations?, enqueues? }` | `{ ok, version }` or `{ ok: false }` |
| `/kv/reset` | `{}` | `{ ok }` |
| `/kv/clean-expired` | `{}` | `{ ok, deleted }` |

### Queue (all POST)

| Endpoint | Body | Response |
|---|---|---|
| `/queue/enqueue` | `{ payload, topic?, delay?, maxAttempts? }` | `{ ok, id }` |
| `/queue/dequeue` | `{ topic?, limit? }` | `{ messages }` |
| `/queue/ack` | `{ id }` | `{ ok }` |

---

## WebSocket

Endpoint: `ws://host/ws` or `ws://host/ws?token=TOKEN`

Uses JSON-RPC format. All methods match their REST counterparts.

### Auth

Two modes:
1. **Query param** — `ws://host/ws?token=TOKEN`
2. **Post-connect** — first message must be `{ id, method: "auth", params: { token } }`

### Push Events

```json
{ "type": "watch", "entries": [...] }
{ "type": "queue", "topic": "...", "message": {...} }
```

---

## License

MIT &copy; 2026 Indra Gunawan
