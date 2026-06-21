<!-- docs: sync from coderbuzz/codex@e9b6bce -->

# KVS Server &mdash; `@coderbuzz/kvs-server`

> **HTTP REST + WebSocket server wrapper for `@coderbuzz/kvs`.** Expose your KV store as a full-featured HTTP API with WebSocket RPC, watch, and push-based queue listeners.
> AI agents: see [AI_KNOWLEDGE.md](https://github.com/coderbuzz/kvs-server/blob/main/AI_KNOWLEDGE.md) for expert context.
<p align="center">
  <a href="https://www.npmjs.com/package/@coderbuzz/kvs-server"><img src="https://img.shields.io/npm/v/@coderbuzz/kvs-server.svg?style=flat-square" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@coderbuzz/kvs-server"><img src="https://img.shields.io/npm/dm/@coderbuzz/kvs-server.svg?style=flat-square" alt="npm downloads" /></a>
  <a href="https://github.com/coderbuzz/kvs-server/blob/main/LICENSE"><img src="https://img.shields.io/github/license/coderbuzz/kvs-server.svg?style=flat-square" alt="MIT License" /></a>
  <a href="https://github.com/coderbuzz/kvs-server"><img src="https://img.shields.io/github/stars/coderbuzz/kvs-server.svg?style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/coderbuzz/kvs-server/actions/workflows/ci.yml"><img src="https://github.com/coderbuzz/kvs-server/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/coderbuzz/kvs-server"><img src="https://codecov.io/gh/coderbuzz/kvs-server/graph/badge.svg" alt="Codecov" /></a>
</p>

KVS Server wraps `@coderbuzz/kvs` (`KVStore` or `AsyncKVStore`) into a production-ready HTTP server with REST endpoints and a WebSocket JSON-RPC interface. It handles authentication, routing, WebSocket upgrade, and protocol translation.

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

### `createServer(store, options): AppServer`

Creates an HTTP server with REST + WebSocket endpoints.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `KVStore` | required | An instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

Returns a Ken `AppServer` instance.

### `createAsyncServer(store, options): AppServer`

Same interface as `createServer` but accepts `AsyncKVStore` instead of `KVStore`. All store calls are awaited internally.

| Param | Type | Default | Description |
|---|---|---|---|
| `store` | `AsyncKVStore` | required | An instance from `@coderbuzz/kvs` |
| `options.port` | `number` | `3000` | HTTP server port |
| `options.hostname` | `string` | `"0.0.0.0"` | Bind address |
| `options.accessToken` | `string` | required | Bearer token for auth |

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
