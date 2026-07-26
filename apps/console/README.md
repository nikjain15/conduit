# @conduit/console

The platform front end for Conduit. It is the control plane operators use to route
use cases across models, set spend caps, review eval gates, watch cost trends, and
track SUQS service level objectives.

Built with Vite, React, and TypeScript. No chart library: the cost bars are plain SVG
style flexbox columns.

## Sections

- Overview: spend this month across use cases plus a health summary from the SUQS targets.
- Models: the core screen. Per use case, a card with a main model, a backup that takes over on a cap hit, a monthly cap in USD, and a cached answer reuse toggle. Caching is locked off for customer facing and financial use cases. Each card has Save and Test actions.
- Eval setup: the gates and thresholds each use case must clear, split into inline and batch checks.
- Cost dashboards: spend per use case over recent months, drawn as scaled bars.
- SUQS SLOs: p95 latency, cost per answer, and gate block rate against target, flagged when over.

## Data layer

All spend and inference reads flow through a single `@conduit/client` running in gateway
mode. By default the client is wired to a local mock adapter in `src/data/mockGateway.ts`,
so `npm run build` produces a static site that works with no backend. Every figure the
console renders is clearly labelled as sample configuration, not a live measurement.

To point the console at a real deployment, set `VITE_CONDUIT_BASE_URL` and
`VITE_CONDUIT_API_KEY` at build time. When a base URL is present the client uses the
global `fetch` transport instead of the mock.

The model catalog follows the inference sampling contract: the newer reasoning models
reject sampling params, Haiku 4.5 and older accept them, and there is no Haiku 5.

## Scripts

- `npm run dev`: start the dev server.
- `npm run build`: run `tsc`, then `vite build` into `dist`.
- `npm run test`: run the vitest smoke tests.
