# Conduit decision log

Trade offs taken, assumptions in force, and what was deliberately left undone.

## Kill criteria

Committed 2026-08-01, before measurement, so the check is honest when it happens.

Conduit exists to make a new AI use case config rather than a rebuild, and to run
in process so there is no latency toll for that convenience. Both halves are
falsifiable:

- **Stop if wiring a new use case takes more than two hours.** Beyond that the
  profile abstraction is costing more than the copy and paste it replaced.
- **Stop if routing through Conduit adds any measurable latency over a direct
  provider call.** The in process design has no excuse for a toll.

Neither has been measured. The first honest test is the next use case wired, and
a latency comparison against a direct SDK call belongs in the same run.

## Assumptions

- **The single builder is the real user.** Conduit is designed for one person
  running several products rather than a team administering policy centrally.
  Cheap way to check: whether the four embedding products actually converge on
  one version of the guardrail rules, or quietly fork them.
- **A deterministic pattern screen is good enough as the first injection line.**
  Now partly falsified by measurement: it is good enough for recall and not good
  enough for precision. See below.

## Open gaps, recorded rather than hidden

**The guardrail floor is not wired to any request path.** Found 2026-08-02 by an
architecture review. `runGuardrails` has three callers: its own tests, its README
example, and the offline eval harness. Neither the gateway handler nor `resolve()`
imports guardrails, so no live request is screened.

This is the most important correction in this document, because ADR-0001 and
SAFETY.md were both written a day earlier describing the floor as enforced. They
described the engine's semantics accurately and never checked its call sites. Both
have been corrected in place with the error recorded rather than edited away.

The lesson generalises and is worth keeping: reading what a module does is not
evidence that anything calls it. Grep for call sites before writing "enforced".

Fix: call `runGuardrails` inside `resolve()`, the one path every request already
takes, so a profile carrying guardrail config is screened without the caller
remembering anything.

**Sampling parameters are not gated by model.** `packages/inference/src/core.ts`
forwards any caller supplied `temperature` to every model without consulting the
catalog, while the README states the core only sends a sampling param to a model
that accepts it. The catalog already records `supportsSampling` per model, so the
data exists and is simply not read on the request path.

Impact: a profile that pins a reasoning tier and carries a temperature gets an
HTTP 400 that looks like an auth or model id failure. This is the day one break
named in the PRD.

Recorded in `evals/dataset/model-contract.jsonl` cases `mc-01` to `mc-05`, and
asserted as an expected failure in `evals/gate.test.ts`. Fixing it means reading
the catalog entry before building the request body and dropping the param when
the model rejects it. Deliberately not done in the same change as writing the
eval, so the eval is seen to fail against the real defect first.

**Guardrails over block one safe request in four.** Measured, not guessed:
precision 0.83 and a false block rate of 0.25 on the golden set, against a recall
of 1.00. A wrongly blocked request has no recovery path, because block outranks
escalate in the severity order. Fix sequence in `docs/SAFETY.md`.

**The judge panel is not yet measured, but it is now measurable.**
`evals/dataset/judge-validation.jsonl` holds 30 class balanced cases with labels
that are decidable from the source rather than a matter of taste, graded on the
two standard dimensions (faithfulness and relevance) separately. The runner
drives the shipped judge, not a copy, and reports Cohen's kappa against a 0.6
floor alongside the base rate and both per-class rates.

Measured 2026-08-02. Groundedness judging with `claude-sonnet-5` reaches kappa
0.93 and is validated. Two things are not, and both were invisible before the
measurement existed:

`claude-haiku-4-5` is unusable as a judge. It fails every case on both
dimensions, giving a flawless catch rate on bad answers and none on good ones,
with agreement below the base rate. Any cost saving from a cheap judge is
unavailable at current quality.

Relevance judging sits near chance (kappa 0.13) even on the strong model, which
would refuse two thirds of genuinely on-topic answers if used as a gate. It is
therefore not enforced and not permitted to gate output. Next step is tuning
`RELEVANCE_CRITERIA` and re-measuring rather than shipping it.

**No cost per use case at volume.** The core records cost per decision and the
console charts it, so the mechanism is there. No document states what a given use
case costs at expected volume, so `docs/COST.md` does not exist rather than
existing and being empty.

**No dependency audit in CI.** Typecheck, tests, and a console build gate every
pull request. Nothing scans dependencies or secrets.

## What the simulated stakeholder reviews changed, 2026-08-02

Three adversarial reviews (architecture, security and privacy, adoption) were run
against this repository on 2026-08-02. They were **simulated**: one person role
playing three reviewers against their own code. No external party reviewed or
approved anything. Full findings and ranks are in `docs/STAKEHOLDERS.md`.

No source file was changed by the reviews. What changed is what is written down.

**Changed: the guardrail floor is now recorded as unenforced on the request
path.** This is the P0 and it was not written down anywhere before.
`runGuardrails` has two callers in the tree, `packages/guardrails/test/engine.test.ts`
and `evals/harness.ts:64`, both test infrastructure. `handleInfer`
(`services/gateway/src/handlers.ts:53`) and `resolve()`
(`packages/inference/src/core.ts:669`) do not call it. `README.md:76` and
`docs/adr/ADR-0001` describe a mandatory floor. What ships is a library function
an integrator has to remember to call, which by the ADR's own argument is weaker
than the per call opt out the ADR rejected. Closing it means calling
`runGuardrails` inside `handleInfer` on both the input and the answer, with a test
that an injection input never reaches `deps.infer`. Open.

**Changed: the published packages do not resolve.** `packages/evals/src/methods.ts:17-19`,
`judgeCheck.ts:16-17`, `gate.ts:21-22`, `packages/agent/src/loop.ts:19` and
`services/gateway/src/mcp.ts:14` import across workspace boundaries by relative
path, while each package packs only its own `src`. `PUBLISHING.md` therefore
describes a publish that would produce broken tarballs, and its stated publish
order calls `agent` internally dependency free, which `loop.ts:19` contradicts.
Fixing it means workspace specifiers plus the missing dependency entries. Open,
and it moves ahead of publishing in priority.

**Changed: deletion is missing from the interface, not just the implementation.**
The earlier entry recorded that no deletion path exists. The review found the
sharper version: `DecisionStore` (`services/gateway/src/types.ts:164`) exposes only
`append` and `query`, so a durable backend has nowhere to hang a delete even if it
wanted one, while `resolve()` stores full prompt content by default
(`core.ts:716`). Open.

**Changed: the tests badge is wrong.** `README.md:7` claims 213 passing; the suite
reports 235 passed and 1 skipped. Small, but a hand maintained number on a project
whose pitch is honest measurement. Open.

**Defended: no token budget in the agent loop.** Every model call flows through the
injected `callModel` (`packages/agent/src/loop.ts:34`), where the caller already
holds usage numbers, so a budget in the loop would duplicate accounting
`resolve()` already does. This is defended only while the caller is the app. It
stops holding the day the loop is driven through the gateway.

**Defended: narrow PII masking.** `packages/guardrails/src/redact.ts` deliberately
mirrors `pii_scan` so the engine and the eval gate cannot disagree about what
counts as PII. Widening it with name and address heuristics would import the same
over blocking failure the injection screen already has at 25 percent. The fix is
to state the three covered shapes in the README, not to guess at names.

**Defended: not publishing to npm yet.** Publishing before the import paths are
fixed would ship packages that do not resolve, and before a versioning policy
exists it would create compatibility promises nobody has defined. Cloning is an
honest install story for a pre adoption project, and the README should say that
plainly instead of implying a registry install works.

**Defended: the order of the sampling parameter fix.** Still open, still a real
defect, still deliberately unfixed until the eval that catches it has been seen
failing against it.

## Scope cuts

- **The gateway is built and not operated.** Auth, tenant isolation and metering
  are implemented and tested; no instance runs. The console runs against a mock
  gateway that starts empty rather than showing invented data.
- **Hosted MCP over HTTP and SSE is designed, stdio is what runs.** Documented in
  `packages/mcp/docs/connecting-clients.md` as the hosted shape.
- **Prompt versioning exists; a staged rollout does not.** Prompts are versioned
  files, and a change must pass the eval gate, but there is no percentage rollout
  or automatic rollback.
