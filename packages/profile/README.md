# @conduit/profile

The foundation that makes Conduit config driven per use case. One `UseCaseProfile`
object holds every knob a use case needs: routing, retrieval, agent, prompt,
guardrails, evals, and service level objectives. Pluggable registries name the
implementations each sub section refers to, and a store backed resolver returns
a fully defaulted profile so executors never null check.

This package owns the shape. Four follow up workstreams fill in the deep logic:
evals, prompts and guardrails, RAG, and the agent loop. Each registers its
implementations into the shared registries and reads the sub section it owns.

## The profile

`UseCaseProfile` sub sections:

- `routing`: main model, optional backup, monthly cap in USD, cached answer reuse.
- `retrieval`: source, chunking, embed model, top K, grounding threshold. RAG workstream.
- `agent`: single or loop mode, tools, skills, max steps. Agent workstream.
- `prompt`: system prompt reference, templates, variables. Prompts workstream.
- `guardrails`: PII, injection guard, output schema, human in the loop threshold, floors. Guardrails workstream.
- `evals`: an array of gate bindings, each with a method, threshold, and an inline or batch schedule. Evals workstream.
- `slo`: p95 latency, cost per answer, gate block rate targets.

Only `id`, `name`, `tenant`, and `routing.main` matter in practice. A partial
profile is valid; the resolver fills the rest.

## Registries

`Registry<T>` is a named map with `register`, `get`, `has`, and `list`. The
shared instances are `methodRegistry`, `retrieverRegistry`, `toolRegistry`,
`skillRegistry`, `promptRegistry`, and `providerRegistry`. They ship empty; each
workstream registers into the one it owns.

## Store, resolver, validator

- `ProfileStore` is the persistence boundary: `get`, `list`, `put`. `InMemoryProfileStore` is included for tests, local development, and the console mock.
- `resolveProfile(store, tenant, useCaseId)` reads a record and applies defaults, returning a complete profile even when the store has no record.
- `validateProfile(profile)` runs structural checks (routing.main required, eval `when` in inline or batch, and more), collects every issue, and never throws.

## Usage

```ts
import {
  InMemoryProfileStore,
  resolveProfile,
  validateProfile,
} from "@conduit/profile";

const store = new InMemoryProfileStore();
const profile = await resolveProfile(store, "org:acme", "kb-search");
const issues = validateProfile(profile);
```

## Tests

```
npx vitest run packages/profile
```
