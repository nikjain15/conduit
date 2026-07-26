# conduit-gateway

The Conduit control-plane service. It is the front door products call: a thin HTTP and MCP surface that adds bearer auth, tenant isolation, and per-tenant usage metering over the platform's cores. All real work (inference, retrieval, agents, evals) is injected, so the gateway stays small and fully unit testable.

It uses only Node's built-in `http` and `URL`. There is no web framework and no runtime dependency to install to serve traffic.

## Design

The service is split into pure logic and a thin port binding.

- Router (`src/router.ts`): a pure `route(req, deps)` that maps `(method, path)` to a handler and returns `{ status, json }`. It owns auth, tenant stamping, and dispatch. It binds no port and reads no clock.
- Handlers (`src/handlers.ts`): pure async functions over the parsed request, the injected cores, and the decision store.
- Server (`src/server.ts`): a thin `http.createServer` listener that parses the request, routes it, and writes the response. It also mounts the MCP transport paths behind the same auth.

### Auth and tenant isolation

Every `/v1/*` route requires `Authorization: Bearer <apiKey>`. The key is resolved to a tenant through the injected `lookupTenant(apiKey)`. A missing or unknown key returns 401. The tenant is derived only from the key and stamped onto the request; a client-supplied `tenant` field in the body is never consulted. Handlers pass the resolved tenant to the cores, so a caller can only ever act as its own tenant.

### Metering and the decision store

The metering seam is the `DecisionStore` interface: `append(record)` writes one metered decision, `query(tenant, { since?, until?, useCase? })` reads a tenant's decisions back. The gateway appends a decision on every `/v1/infer` call and on every `POST /v1/decisions` report. Both `/v1/usage` and `/v1/suqs` are built by querying the store, scoped to the calling tenant.

A metered decision is `{ tenant, useCase, model, provider?, costUsd, latencyMs, tokensIn?, tokensOut?, gateStatus?, at }`. The tenant is always stamped from the resolved API key; a client-supplied tenant field is ignored.

The default `InMemoryDecisionStore` buckets decisions per tenant so a query for one tenant never scans another's rows. It is the seam where a durable database drops in: implement the same interface with `append` as an INSERT and `query` as a tenant-scoped SELECT filtered on `at` and `useCase`. A schema such as `decisions(tenant, use_case, model, provider, cost_usd, latency_ms, tokens_in, tokens_out, gate_status, at)` indexed on `(tenant, at)` and `(tenant, use_case)` serves both endpoints. No database dependency is added now; the interface is the only contract the handlers depend on.

Every figure the endpoints return is derived from real recorded decisions. With no decisions, `/v1/usage` returns `{ totalCostUsd: 0, byUseCase: {} }` and `/v1/suqs` returns `{ byUseCase: [] }`. Neither ever fabricates a number.

### SUQS

`GET /v1/suqs?window=` computes, per use case, from real decisions: p95 latency (nearest-rank), cost per answer (mean cost), and gate block rate (share of decisions with `gateStatus: "block"`). When a `sloTargets(tenant, useCase)` lookup is injected, each row carries the profile SLO target it should be read against; otherwise the target is null. It never invents a target.

## Endpoints

| Method | Path | Auth | Body / Query | Returns |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | none | | `{ ok: true }` |
| POST | `/v1/infer` | bearer | `{ useCase, messages, system?, maxTokens?, pinModel? }` | `{ output, model, provider, costUsd, latencyMs, decisionId }` |
| POST | `/v1/retrieve` | bearer | `{ query, topK? }` | `{ chunks, grounded }` |
| POST | `/v1/agent` | bearer | `{ goal, maxSteps? }` | `{ answer, steps }` |
| POST | `/v1/evals/run` | bearer | `{ datasetId }` | `{ summary, metrics }` |
| POST | `/v1/decisions` | bearer | `{ useCase, model, costUsd, latencyMs, provider?, tokensIn?, tokensOut?, gateStatus?, at? }` | `{ accepted, tenant }` |
| GET | `/v1/usage` | bearer | `?window=` | `{ totalCostUsd, byUseCase }` |
| GET | `/v1/suqs` | bearer | `?window=` | `{ byUseCase }` |
| GET | `/sse` | bearer | | MCP event stream |
| POST | `/messages` | bearer | `?sessionId=` | MCP message ack |

The `window` value accepts `<n>h`, `<n>d`, `<n>m`, or a bare number of hours. Anything else means all time.

## MCP

The same cores are exposed as MCP tools (`infer`, `retrieve`, `agent`, `evals_run`) through `@conduit/mcp`. The transport (`GET /sse`, `POST /messages`) sits behind the same bearer auth, and every tool call runs against the caller's resolved tenant.

## Usage

```ts
import { createGatewayServer, InMemoryDecisionStore } from "conduit-gateway";

const server = createGatewayServer({
  lookupTenant: (apiKey) => keyTable[apiKey] ?? null,
  store: new InMemoryDecisionStore(),
  infer: async (task, tenant) => { /* delegate to @conduit/inference */ },
  retrieve: async (task, tenant) => { /* delegate to @conduit/rag */ },
  runAgent: async (task, tenant) => { /* delegate to @conduit/agent */ },
  evaluate: async (task, tenant) => { /* delegate to @conduit/evals */ },
});
server.listen(8787);
```

## Test

```
npx vitest run services/gateway
```

Tests call the router and handlers directly with injected fakes. No port is bound and no network is touched.
