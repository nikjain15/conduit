# @conduit/client

The thin SDK an app imports to talk to Conduit. One method surface, two transports. No external dependencies: the caller injects `fetch` (gateway mode) or the core functions (embedded mode), so the package installs nothing and stays easy to test.

## Why two modes

The same client API works whether the core runs in your process or behind the gateway. You write against `createClient(config)` once and choose the transport by config.

- `mode: "embedded"` runs the core in process by calling injected functions from the other packages (`resolve` from `@conduit/inference`, retrieval from `@conduit/rag`, `runAgent` from `@conduit/agent`, the eval runner from `@conduit/evals`, plus a usage reader). Low latency, no network hop. The app is responsible for binding each function's runtime context before injecting it.
- `mode: "gateway"` calls the conduit-gateway over HTTP using an injected `fetch`, against the fixed API contract below.

Switching mode changes the transport, never the methods.

## Install

Nothing to install. Import from the workspace and inject what the mode needs.

## Usage

Embedded:

```ts
import { createClient } from "@conduit/client";

const client = createClient({
  mode: "embedded",
  tenantId: "org:acme",
  core: { resolve, retrieve, runAgent, evaluate, usage },
});

const res = await client.infer({
  useCase: "chat",
  messages: [{ role: "user", content: "hello" }],
});
```

Gateway:

```ts
import { createClient, ConduitError } from "@conduit/client";

const client = createClient({
  mode: "gateway",
  apiKey: process.env.CONDUIT_API_KEY!,
  baseUrl: "https://gateway.conduit.dev",
  fetch, // the global fetch, or any spec-compatible mock
});

try {
  const res = await client.infer({
    useCase: "chat",
    messages: [{ role: "user", content: "hello" }],
  });
} catch (err) {
  if (err instanceof ConduitError) {
    console.error(err.status, err.body);
  }
}
```

## Methods

Identical in both modes.

- `infer({ useCase, messages, system?, maxTokens?, pinModel? })` returns `{ output, model, provider, costUsd, latencyMs, decisionId }`.
- `retrieve({ query, topK? })` returns `{ chunks: [{ id, score, text }], grounded }`.
- `runAgent({ goal, maxSteps? })` returns `{ answer, steps }`.
- `evaluate({ datasetId })` returns `{ summary, metrics }`.
- `usage({ window? })` returns `{ totalCostUsd, byUseCase }`.

## Gateway HTTP contract

Every call sends `Authorization: Bearer <apiKey>`.

| Method | HTTP |
| --- | --- |
| `infer` | `POST /v1/infer` |
| `retrieve` | `POST /v1/retrieve` |
| `runAgent` | `POST /v1/agent` |
| `evaluate` | `POST /v1/evals/run` |
| `usage` | `GET /v1/usage` |

A non-2xx response is thrown as a `ConduitError` carrying `status` and the parsed `body`.

## Errors

`ConduitError` (gateway mode) exposes `status: number` and `body: unknown`. Embedded mode surfaces whatever the injected core function throws.

## Test

From the repo root:

```
npx vitest run packages/client
```
