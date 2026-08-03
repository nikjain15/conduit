# Cost

Conduit is the control plane the other products route through, so this document answers a
different question from a product's cost page. Not "what does this app spend", but **what
does the routing table cost, and what is the routing decision itself worth**.

Regenerate with `npm run cost:model`. The figures come from
[`scripts/cost-model.mjs`](../scripts/cost-model.mjs), which parses `DEFAULT_ROUTING` and
`DEFAULT_PRICES` out of `packages/inference/src/core.ts`. Every use case, model id and price
below is the config that routes real traffic, not a number retyped into a document.

## The routing table, priced

| Use case | Routes to | ~In | ~Out | Per call | Calls/day | Cost/day |
|---|---|---|---|---|---|---|
| `chat` | claude-haiku-4-5 | 500 | 300 | $0.00200 | 400 | $0.80 |
| `insights` | claude-sonnet-4-6 | 5000 | 1000 | $0.03 | 20 | $0.60 |
| `email_compose` | Workers-AI llama 3.3 (free tier) | 750 | 375 | **$0** | 60 | **$0** |
| `content_draft` | claude-sonnet-4-6 | 1500 | 1500 | $0.03 | 30 | $0.81 |

Per tenant over 30 days: **$66.30 as routed**, against **$128.47** if every call ran on the
dearest model in the table. **Routing saves 48%.**

## Volume and cost are almost unrelated

| Use case | Share of calls | Share of cost |
|---|---|---|
| `chat` | **78%** | 36% |
| `email_compose` | 12% | **0%** |
| `content_draft` | 6% | **37%** |
| `insights` | 4% | 27% |

**The busiest use case is a third of the bill and the quietest two are two thirds of it.**
`chat` is 400 of 510 daily calls and costs less than `content_draft`, which is 30 calls. Per
request, an `insights` run costs 15x a chat turn.

That is the routing table working exactly as designed, and it is the argument for having one
at all. It also means **request counts are a bad proxy for spend here**, and any cost alarm
built on request volume would be watching the wrong number.

**`email_compose` is genuinely free.** 60 calls a day, 12% of all traffic, at zero cost,
because it routes to a Workers-AI model on the free tier. Token usage is still recorded, so it
shows up in the KPIs at zero rather than being invisible. That distinction matters, and the
next section is about the case where it did not hold.

## The zero that was not free

Until 2026-08-02, `computeCostUsd` did `if (!p) return 0` for a model with no row in
`DEFAULT_PRICES`. A genuinely free model and a model nobody had priced produced the **same
number**.

That was reachable. The table lists Haiku, Sonnet 4.6 and the free Workers-AI model, while
callers may pass any model through `pinModel` and admin config can rewrite the table at
runtime. It also failed in the dangerous direction: the cost KPIs read healthiest exactly when
an expensive unfamiliar tier was introduced, because the more unknown the model, the more
certainly it was billed at nothing.

Unknown models now bill at `UNPRICED_FALLBACK` ($5/$25, the priciest tier Conduit knows) and
`computeCost` returns an `unpriced` flag, so an estimate is distinguishable from a
measurement. A genuinely free model still costs zero, flagged `unpriced: false`.
`packages/inference/test/cost.test.ts` pins all of it, including a test that the fallback is at
least as expensive as the dearest known tier.

**One consequence shows up in the table above.** The "everything on the dearest model"
comparison is against Sonnet 4.6, because Conduit's price table has no Opus row. That is a
real limit of this model, not a claim that nothing dearer exists. If Opus traffic starts
flowing through Conduit, add the row.

## What is measured, estimated, and assumed

| | |
|---|---|
| **Measured from source** | every use case, the model each routes to, and every per-million-token price. Parsed from `core.ts`, not retyped |
| **Estimated** | token counts, as characters / 4. The largest source of error, not calibrated against Anthropic's tokenizer |
| **Assumed** | prompt and reply sizes per use case, and the daily request mix |

**Every dollar figure is an order of magnitude, not a bill.**

The request mix is the softest assumption and it drives the headline directly. 20 `insights`
runs a day against 400 chat turns is a guess about how tenants behave. If `insights` is really
100 a day, it becomes the largest line and the routing saving grows.

The script refuses to hide two specific gaps: a use case that is routed but has no assumed
shape is reported as **routed but not modelled**, and an assumed shape with no route is
reported as **stale**. Both currently empty.

## What replaces this with measurements

Conduit already prices every real call. `computeCost` runs in the resolve path and the result
lands on the cost KPIs, so one day of live traffic makes this script redundant for anything
except forecasting. Until that traffic exists, this is a model, and it says so.

## What this document does not claim

**The routing is chosen, not validated.** `chat` runs on Haiku because Haiku is the cheap tier,
not because Haiku was measured as good enough on Conduit's own examples, and `email_compose`
runs on Workers-AI because it is free. Those are reasonable design decisions. Turning them into
validated ones needs an eval comparing tiers on the same inputs, with a keyed run.

**No caching is modelled.** Conduit's gateway cache is deliberately off (D11) so answers stay
byte-identical and never cross tenants. That is a correctness decision, and any future cost
saving from caching has to clear that bar first, not the other way round.

## Related

Prices were audited across all five products on 2026-08-02, and three of five were wrong in two
different ways. Rally and FounderFirst both carried Opus at $15/$75, which is Opus-3-era pricing
feeding a live meter. Conduit had the prices right and the missing-price fallback wrong. Pulse
and RoleOS were correct.
