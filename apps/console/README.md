# @conduit/console

The platform front end for Conduit. It is the control plane operators use to route
use cases across models, set spend caps, review eval gates, watch cost trends, and
track SUQS service level objectives.

Built with Vite, React, and TypeScript. No chart library: the cost bars are plain SVG
style flexbox columns.

## Apps and use cases

Every use case belongs to one app, and every tab groups its use cases under the app they
belong to, so a card or row always reads as "app / useCase". The fleet is FounderFirst
(penny_categorize, penny_insights), RoleOS (match, screen, build, coach, negotiate),
Pulse (ask-pulse), and Rally (ask, detect). In production the app a caller belongs to is
derived from the bearer token, never the request body; the gateway groups usage and suqs
by it.

## Sections

- Overview: spend this month per app plus a health summary, both read live from the gateway usage and suqs endpoints.
- Models: the core screen. Cards are grouped under an app heading, one per use case, over the live model catalog: a main model, a backup that takes over on a cap hit, a monthly cap in USD, and a cached answer reuse toggle. Caching is locked off for customer facing and financial use cases. Each card has Save and Test actions.
- Eval setup: the gates and thresholds each use case must clear, grouped by app, split into inline and batch checks.
- Cost dashboards: a per-app spend rollup first, then the per-use-case breakdown within each app, read live from the gateway usage endpoint and drawn as scaled bars.
- SUQS SLOs: p95 latency, cost per answer, and gate block rate computed live from real metered decisions, grouped by app, against target, flagged when over.

## Data layer

All telemetry and inference reads flow through a single `@conduit/client` running in
gateway mode. The client exposes `usage`, `suqs`, and `reportDecision` alongside the
inference methods.

The distinction the console keeps honest:

- Live telemetry (Overview, Cost dashboards, SUQS SLOs) reads real records through the
  gateway. There is no sample spend or sample latency anywhere. When the gateway has no
  records, these views render an explicit "No live data yet" panel rather than any number.
- Sample configuration (Models routing defaults, Prompts, Guardrails, Agent, Eval setup,
  Retrieval) is placeholder config, and the pages that show it carry a sample notice.

By default the client is wired to a local mock adapter in `src/data/mockGateway.ts`, so
`npm run build` produces a static site that works with no backend. The mock backs
`usage`, `suqs`, and `reportDecision` with an in-memory decision store that starts EMPTY,
so the offline console demonstrates the honest empty state rather than invented figures.

To point the console at a real deployment, set `VITE_CONDUIT_BASE_URL` and
`VITE_CONDUIT_API_KEY` at build time. When a base URL is present the client uses the
global `fetch` transport instead of the mock, and the live views fill in as the running
gateway meters real traffic.

The model catalog follows the inference sampling contract: the newer reasoning models
reject sampling params, Haiku 4.5 and older accept them, and there is no Haiku 5.

## Scripts

- `npm run dev`: start the dev server.
- `npm run build`: run `tsc`, then `vite build` into `dist`.
- `npm run test`: run the vitest smoke tests.
