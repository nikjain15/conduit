# @conduit/inference

Conduit inference core: the single `resolve()` that every AI request passes through. A runtime-agnostic core with per-runtime adapters (workers, deno, node) and provider adapters (Anthropic, Workers-AI, OpenRouter). It is the single source of truth for routing, cost math, and the decision record.

## Install

```
npm install @conduit/inference
```

The package ships TypeScript source under `src/`. Consumers compile it through their own bundler or `tsc`.

## Usage

```ts
import { resolve } from "@conduit/inference";
import { resolveOnNode } from "@conduit/inference/adapters/node";
```

- `resolve(task, ctx)` and per-runtime adapters (`resolveOnNode`, and the workers and deno equivalents).
- `judge(input, jctx)` for the inline runtime gate and LLM-judge panel.
- `computeCostUsd`, `DEFAULT_CONFIG`, and the `AiDecisionRecord` telemetry type.

## Sampling contract

Only send `temperature`, `top_p`, or `top_k` to a model where sampling is supported. Several current models reject sampling params, so the core guards them before dispatch. Reuse that guarding rather than passing sampling params blindly.

## License

MIT
