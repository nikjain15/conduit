# Conduit

The internal AI platform that products plug into: one place for model routing, evals, retrieval, agent orchestration, and cost governance, exposed over a standard interface (including MCP).

Conduit is **hybrid** by design:

- A **control plane and distribution surface**: a console for model config, eval setup, and cost dashboards; a gateway that speaks HTTP and MCP.
- A set of **embeddable core packages**: apps import them and run inference **in process**, so every product stays runnable standalone and low latency. Apps can opt into the gateway when they want centralized routing.

That split is deliberate. The runtime path is a pure, in-process function so a single product clone runs its own AI with no network dependency; the platform owns configuration, evaluation, distribution, and observability.

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
| Package | `@conduit/guardrails` | Fail-closed policy engine: prompt-injection detection, PII redaction or block, output-schema enforcement, human-in-the-loop escalation, and mandatory floors. |
| Package | `@conduit/client` | The thin SDK an app imports: embed the core in process, or point at the gateway. |
| Service | `conduit-gateway` | Back end: HTTP plus MCP over the packages, with auth, tenant isolation, and metering. |
| App | `conduit-console` | Front end: model config, eval setup, RAG config, cost dashboards, SUQS SLOs. |

## Model contract

Sampling parameters (`temperature` / `top_p` / `top_k`) are a per-model API contract, not a preference. Current reasoning tiers (Opus 5 / 4.8 / 4.7, Sonnet 5, Fable 5) reject them with HTTP 400; Haiku 4.5 and older accept them. The core only sends a sampling param to a model that accepts it and relies on grounded prompts for determinism elsewhere.

## Status

All ten packages typecheck clean and are unit-tested in CI (213 tests), with `@conduit/inference` promoted from a production inference core. The gateway and console build in CI, and the console is live at nikjain15.github.io/conduit against a mock gateway that starts empty, real usage and SUQS SLOs appear once a gateway runs with a live API key and metered traffic. The four apps embed the client and route their AI through Conduit in process today; central gateway reporting is wired and dormant until a gateway is deployed.
