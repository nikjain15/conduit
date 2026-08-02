# Conduit

**One control plane for model routing, evals, RAG, agents, and cost, so a new AI use case is config, not a rebuild.**

[![CI](https://github.com/nikjain15/conduit/actions/workflows/ci.yml/badge.svg)](https://github.com/nikjain15/conduit/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-275%20passing-brightgreen.svg)](https://github.com/nikjain15/conduit/actions/workflows/ci.yml)
[![packages](https://img.shields.io/badge/packages-10-informational.svg)](#layout)

Live console: **[nikjain15.github.io/conduit](https://nikjain15.github.io/conduit)** (runs against a mock gateway that starts empty).

Demo GIF below.

<!-- DEMO_GIF -->

Conduit is **hybrid** by design:

- A **control plane and distribution surface**: a console for model config, eval setup, and cost dashboards; a gateway that speaks HTTP and MCP.
- A set of **embeddable core packages**: apps import them and run inference **in process**, so every product stays runnable standalone and low latency. Apps can opt into the gateway when they want centralized routing.

The runtime path is a pure, in-process function, so a single product clone runs its own AI with no network dependency. The platform owns configuration, evaluation, distribution, and observability. Every request resolves through one core that speaks to multiple providers (Anthropic, Cloudflare Workers-AI, OpenRouter), and a new use case is a `UseCaseProfile` object, not a fresh integration.

## Why I built this

The same plumbing gets rebuilt for every AI product: routing, retrieval, an agent loop, evals, guardrails, cost tracking. Each rebuild drifts, and none of it is reusable. Conduit makes that plumbing one config-driven control plane, so shipping a new use case means writing a profile, not re-implementing the stack.

## Try it in 60 seconds

Run the console locally:

```bash
git clone https://github.com/nikjain15/conduit.git
cd conduit
npm install
npm run dev --workspace @conduit/console
```

Vite serves the console; open the printed local URL. It runs against a mock gateway that starts empty, so no API key is needed to explore.

Connect an external agent to a Conduit MCP server over stdio. Write a small entry script that wires your tools:

```ts
import { startStdioServer } from "@conduit/mcp/stdio";
import { tools } from "./my-tools";

await startStdioServer({ name: "conduit", version: "0.1.0", tools });
```

Then point a local MCP client (such as Claude Desktop) at it:

```jsonc
{
  "mcpServers": {
    "conduit": {
      "command": "node",
      "args": ["./dist/conduit-mcp-stdio.js"]
    }
  }
}
```

The client calls `tools/list` to discover tools and `tools/call` to run one; arguments are validated against each tool's JSON Schema before the handler runs. See [`packages/mcp/docs/connecting-clients.md`](./packages/mcp/docs/connecting-clients.md) for the hosted HTTP/SSE shape.

## Layout

| Unit | Name | Role |
|---|---|---|
| Package | `@conduit/inference` | The `resolve()` core every AI request passes through. Provider adapters: Anthropic, Cloudflare Workers-AI, OpenRouter. Runtime adapters: workers / deno / node. Routing, cost math, and one decision record. |
| Package | `@conduit/rag` | Retrieval (pgvector + BM25), grounding, and the two RAG failure modes handled explicitly. |
| Package | `@conduit/agent` | A bounded agent loop: goal plus typed tools plus runtime-loaded skills. Reads only, no unchecked side effects. |
| Package | `@conduit/evals` | The eval ladder: deterministic gates, an LLM-judge panel, named metrics (recall / precision / F1). |
| Package | `@conduit/mcp` | Build an MCP server from a set of tools; stdio for local, HTTP/SSE for hosted distribution. |
| Package | `@conduit/catalog` | Live model catalog from OpenRouter plus curated Anthropic and Workers-AI tiers, with use-case-aware recommendations. |
| Package | `@conduit/profile` | The `UseCaseProfile`: the single config object that composes routing, retrieval, agent, prompts, guardrails, evals, and SLOs per use case. A new use case is config, not a redeploy. |
| Package | `@conduit/prompts` | Versioned prompt registry with template and variable resolution. |
| Package | `@conduit/guardrails` | Fail-closed policy engine: prompt-injection detection, PII redaction or block, output-schema enforcement, human-in-the-loop escalation, mandatory floors, and the untrusted data envelope. Called by `resolve()`, so a use case profile carrying the config is screened without the caller wiring anything. |
| Package | `@conduit/client` | The thin SDK an app imports: embed the core in process, or point at the gateway. |
| Service | `conduit-gateway` | Back end: HTTP plus MCP over the packages, with auth, tenant isolation, and metering. |
| App | `conduit-console` | Front end: model config, eval setup, RAG config, cost dashboards, SUQS SLOs. |

## Model contract

Sampling parameters (`temperature` / `top_p` / `top_k`) are a per-model API contract, not a preference. Current reasoning tiers (Opus 5 / 4.8 / 4.7, Sonnet 5, Fable 5) reject them with HTTP 400; Haiku 4.5 and older accept them. The core only sends a sampling param to a model that accepts it and relies on grounded prompts for determinism elsewhere.

## Status

All ten packages typecheck clean and are unit-tested in CI (275 tests), with `@conduit/inference` promoted from a production inference core. The gateway and console build in CI, and the console is live at nikjain15.github.io/conduit against a mock gateway that starts empty, real usage and SUQS SLOs appear once a gateway runs with a live API key and metered traffic. The four apps embed the client and route their AI through Conduit in process today; central gateway reporting is wired and dormant until a gateway is deployed.
