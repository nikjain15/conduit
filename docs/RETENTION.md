# Data retention and deletion

What Conduit keeps, for how long, and what deletes it. Every window below names
the code that enforces it, or says plainly that nothing does.

Written 2026-08-02. Before this, the gateway's decision store had no retention
window and no deletion path: `DecisionStore` held only `append` and `query`, so a
durable backend had nowhere to hang a delete even if it wanted one. Keeping
everything forever was the default by omission rather than by decision.

## Windows

| Data | What it is | Kept | Enforced by |
|---|---|---|---|
| Decision rows | Cost, latency, model, provider, use case, gate status, timestamp. No prompt or answer text. | 400 days | `applyRetention` in `services/gateway/src/metering.ts`, calling `DecisionStore.purge` |
| Refusal causes | The guardrail pattern that fired, the signal, the outcome, and optional use case and tenant labels. No request content. | 400 days in the decision store; the in-process ledger holds the most recent 500 events and is lost on restart | `purge`, same path. The ledger is bounded in `packages/guardrails/src/ledger.ts` |
| Prompt and answer content | The `input` and `output` fields of the inference decision record written by `resolve()`. | 30 days | **Nothing in this repo.** See below |
| Profiles, prompts, catalog | Configuration, versioned in git. | Indefinite, by design | Not applicable |

**400 days for decisions** so a year-over-year cost comparison has two data
points, and no longer, so the store does not become a permanent archive.

**30 days for content** because prompt and answer text is the most sensitive
thing the platform touches and the least often needed after a fortnight. An
incident review is the only real use, and incident reviews happen quickly or not
at all.

## The gap, stated plainly

The content window is policy, not code. The gateway's `Decision` type carries no
prompt or answer text at all, so purging the gateway store does not touch
content. Content lives in the inference decision record (`ai_decisions`), which
is written through an injected `recordSink` to a database this repo does not own
and cannot purge from here.

What exists today:

- `resolve()` accepts `record.storeInput: false`, which stores no input at all.
  That is minimisation, and it is the strongest content control available now.
- `RetentionPolicy.contentDays` states the intended window in one place, so the
  number is not invented differently by each caller.

What does not exist: a scheduled job against `ai_decisions`. Until one runs, the
30 day content window is an intention. It should not be described as enforced,
and no document here does.

## Deletion by tenant

`DecisionStore.deleteTenant(tenant)` erases every decision for one tenant and
returns the count. It is a required method on the interface, not an optional one,
so a durable backend cannot implement the store without a delete path.

Tenant scoped rather than user scoped because the store is bucketed by tenant,
which is the same property that makes isolation a storage-layer invariant rather
than an application-layer filter. Erasing a single end user inside a tenant is
NOT supported: no decision row carries a user id. Adding one would mean adding an
identifier the platform currently does not hold, which is a decision with its own
privacy cost and has not been taken.

## Running the purge

```ts
import { applyRetention, DEFAULT_RETENTION } from "@conduit/gateway";

const deleted = await applyRetention(store, Date.now(), DEFAULT_RETENTION);
```

Idempotent: a second run deletes nothing more. It returns a count so a scheduled
job can log a real number rather than "done". No scheduler ships in this repo;
wiring it to the host's cron is the operator's step, and the gateway is built and
not operated today (`docs/DECISION_LOG.md`).

Tests: `services/gateway/test/gateway.test.ts`, the `retention` block.
