# Conduit PRD

Status: in use by four products, pre external adoption. Everything below
describes what the code does today. Anything not yet built says so.

## Problem

The same plumbing gets rebuilt for every AI product: routing, retrieval, an agent
loop, evals, guardrails, cost tracking. Each rebuild drifts from the last, and
none of it is reusable. By the third product the four copies disagree about which
models accept which parameters, what counts as PII, and what a blocked request
looks like.

## Users

**Primary: a solo builder shipping their second or third AI product.** They have
already written the routing and guardrail code once. They do not want to write it
again, and more importantly they do not want four copies of it drifting apart.

Today that is the maintainer, across Pulse, Rally, RoleOS and FounderFirst. The
design target is the same person outside this account, which is why every package
runs standalone with no gateway and no account.

**Not serving yet:** teams needing centralised policy administration across
several engineers, and anyone needing a hosted multi tenant control plane as a
product. The gateway supports tenant isolation and metering, but it is not
operated as a service.

### The messy input that breaks it on day one

The builder copies a `UseCaseProfile` from an older app into a new one. The old
profile carries `temperature: 0.7`, which was correct for the model it was
written against. The new profile pins a reasoning tier, and current reasoning
tiers reject sampling parameters with an HTTP 400.

The failure is bad in a specific way: a 400 with a parameter error does not look
like a config mistake, it looks like a bad API key or a wrong model id, so the
builder debugs the wrong thing. This is the exact case
`evals/dataset/model-contract.jsonl` exists to catch, and it is a known open gap
in the core today, recorded in `docs/DECISION_LOG.md`.

## Job to be done

"When I start a new AI use case, help me get routing, guardrails, evals and cost
tracking working in an afternoon, so I am building the product instead of
rebuilding the plumbing."

The workaround it has to beat is copy and paste from the previous repo, which is
faster on day one and worse by month three.

## Differentiation

A raw provider SDK gives you a model call. Conduit adds the layer that decides
whether that call should happen and whether its output may ship: a policy engine
that cannot be switched off per call, an agent loop that refuses side effects by
default, and a cost and decision record per request. The judgment layer is the
product; the model call is the easy part.

## Quality bar

Three lines, all measurable today.

- **Good enough to ship.** Typecheck and the full suite pass, and the eval gate
  in `evals/gate.test.ts` clears its floors: guardrail recall at or above 0.95,
  precision at or above 0.75, false block rate at or below 0.35.
- **Delightful.** Recall stays at 1.00 while the false block rate falls below
  0.10, so the guard stops refusing legitimate business requests. Measured
  baseline today is a 0.25 false block rate, so this is not met.
- **Never ship below this.** Any injection case in the golden set reaching
  `allow`, any mandatory floor failing open, or any side effecting tool running
  without explicit authority.

Current state against that bar: the ship line is met, the delight line is not.

## Metrics

- **Working:** number of use cases wired without writing integration code, and
  time from a new profile to a first correct response.
- **Warning:** the false block rate in `evals/README.md`. It is the number that
  says Conduit is harming the products that depend on it rather than protecting
  them.

Honest gap: neither number is instrumented in production. The false block rate is
measured offline on a synthetic set. Wiring the guardrail decision record to a
counter per app is the next step, and until then the warning metric is an
estimate.

## Cost

Cost per request is recorded per decision by the inference core and surfaced in
the console's cost dashboards. There is no written cost per use case at expected
volume yet. See `docs/DECISION_LOG.md` for why that is open rather than answered.

## When to stop

The kill line, committed in advance: **if wiring a new use case takes more than
two hours, or routing through Conduit adds any measurable latency over calling
the provider directly, the premise has failed.** Conduit exists to make a new use
case config rather than a rebuild, and to run in process precisely so there is no
latency toll. If either stops being true, the honest move is to stop investing
and go back to a thin shared library.

Not yet checked against reality: neither number has been measured. Measuring
time to wire the next use case, and a latency comparison against a direct SDK
call, is the first thing that should happen after this document lands.

## Eval plan

Two golden sets, scored separately because they fail for different reasons and
have different fixes. See `evals/README.md` for the measured baseline, the four
known false blocks, and the recorded gap in the model contract. Both sets are
synthetic today; folding in real blocked inputs from the four embedding products
is the highest value next addition.
