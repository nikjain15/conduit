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

What is still open is the run itself: `evals/results/judge-validation.json` is a
placeholder with an empty `reports` array, so no claim about judge accuracy is
supported yet. Running it needs an ANTHROPIC_API_KEY, and the workflow at
`.github/workflows/judge-validation.yml` will do it on judge-touching pull
requests and weekly once that secret is set.

**No cost per use case at volume.** The core records cost per decision and the
console charts it, so the mechanism is there. No document states what a given use
case costs at expected volume, so `docs/COST.md` does not exist rather than
existing and being empty.

**No dependency audit in CI.** Typecheck, tests, and a console build gate every
pull request. Nothing scans dependencies or secrets.

## Scope cuts

- **The gateway is built and not operated.** Auth, tenant isolation and metering
  are implemented and tested; no instance runs. The console runs against a mock
  gateway that starts empty rather than showing invented data.
- **Hosted MCP over HTTP and SSE is designed, stdio is what runs.** Documented in
  `packages/mcp/docs/connecting-clients.md` as the hosted shape.
- **Prompt versioning exists; a staged rollout does not.** Prompts are versioned
  files, and a change must pass the eval gate, but there is no percentage rollout
  or automatic rollback.
