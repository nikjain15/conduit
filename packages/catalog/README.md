# @conduit/catalog

The normalized model catalog for Conduit. It gives the rest of the platform one
shape, `CatalogModel`, for every model it can route to, whether that model comes
live from OpenRouter or from a small curated list of managed and edge providers.

## Why

OpenRouter exposes hundreds of open and closed models behind one key, and the
set changes over time. Hard coding a model list goes stale. This package fetches
the live list, normalizes it, and merges it with the curated Anthropic tiers and
a couple of Cloudflare Workers-AI open models so any available model can be
routed and the right ones can be surfaced per use case.

## Public API

- `fetchOpenRouterModels(fetchImpl, { apiKey?, endpoint? })`: GET the OpenRouter
  models endpoint (fetch is injected) and normalize each record into a
  `CatalogModel`. Prices arrive per token and are converted to per million.
  Sampling support is derived from `supported_parameters` including
  `"temperature"`; tool support from it including `"tools"`. A non-ok response
  throws `OpenRouterFetchError` carrying the status and body.
- `normalizeOpenRouterModel(raw)`: the pure per-record normalizer.
- `ANTHROPIC_MODELS`, `WORKERS_AI_MODELS`, `CURATED_MODELS`: static curated
  entries in the same `CatalogModel` shape.
- `mergeCatalog(openrouterModels, curated)`: concatenate live and curated lists.
- `recommendForUseCase(models, profile, limit?)`: ranked list of refs for a use
  case. See below.
- `USE_CASE_PROFILES`: per-use-case profiles shared by the gateway and console.

## CatalogModel

```
{ ref, id, name, provider, contextLength, promptPerMTok, completionPerMTok,
  inputModalities, outputModalities, supportsSampling, supportsTools }
```

`ref` is the provider-prefixed id the rest of Conduit routes on, for example
`openrouter/meta-llama/llama-3.3-70b-instruct`. Prices are USD per million
tokens. Curated managed tiers are billed under separate agreements, so their
price fields are left at 0 as a "not price listed here" placeholder rather than
an invented number. Workers-AI carries a genuine free-tier 0.

## Recommendation heuristic

`recommendForUseCase` is a transparent, documented heuristic, not a quality
benchmark. It filters to models that can serve the use case (text output, plus
tools and long context when the profile requires them), then orders by one
explicit signal: for `costSensitivity: "high"` it lists the cheapest prompt
price first; for `"low"` it uses a capability proxy, longest context first with
price as a rough tiebreak. No eval scores or quality rankings are consulted.

## Testing

`recommendForUseCase`, `mergeCatalog`, and the normalizer are pure. Tests inject
a mock fetch and never touch the network.
