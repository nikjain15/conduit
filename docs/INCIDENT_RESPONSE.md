# Incident runbook

For the AI specific incident: a bad prompt is live, a model change altered
behaviour underneath you, a guardrail is refusing real users, or an injection got
through. Ordinary outages are not covered here.

The order below is deliberate. Every step is chosen to be reversible before it is
correct, because the fastest way to make an incident worse is to debug in
production while users are still being served the broken thing.

## 0. Decide it is an incident (2 minutes)

Say out loud which of these is true, because the answer picks the path:

- **Users are getting harmful or wrong output.** Stop serving it. Go to step 1.
- **Users are being refused wrongly.** Nothing harmful is shipping. You have
  hours, not minutes. Go to step 2, then the false block path in step 3.
- **Something got through the guard but nothing is harmful yet.** Go to step 4;
  the eval case matters more than the rollback.

Write the start time down. Every later claim about "when it started" will
otherwise be a guess.

## 1. Roll back, in this order

Cheapest and most reversible first. Do not skip ahead to the interesting cause.

1. **The prompt.** Prompts are versioned files (`packages/prompts`). Revert to
   the previous version and deploy. This is the fastest lever and it is the cause
   more often than the model is.
2. **The routing.** If the prompt is not it, pin the use case back to the model
   it used before, through the profile's `routing.main`. A provider changing a
   model underneath a stable id is a real failure mode and looks exactly like a
   regression you did not ship.
3. **The guardrail config.** If the incident is output getting through, turn the
   relevant signal on for that use case (`pii`, `outputSchema`, a floor). If the
   incident is refusals, do NOT switch the guard off. Set
   `blockedRequestAction: "review"` so refused requests route to a human instead
   of dying, which keeps the floor on while the user gets a path forward.
4. **The code.** Revert the deploy. Last because it is the slowest and the widest
   blast radius, and because the three above cover most causes without it.

After each step, check whether the symptom is gone before doing the next one. A
rollback whose effect you did not measure teaches nothing and may be masking a
second cause.

## 2. Preserve the evidence before it expires

Decision records hold 400 days; **content holds 30** (`docs/RETENTION.md`). If
the incident touches what a model was actually sent or actually said, copy those
records out now. In 31 days the question becomes unanswerable.

Capture, at minimum:

- the decision ids and the exact `input` and `output` of two or three examples,
- the model and provider actually served (`providerModel`, not the routed id),
- the guardrail verdict on the record (`evals.guardrail`), including the pattern
  that fired,
- the block ledger snapshot if the incident is about refusals
  (`blockLedgerSnapshot()` from `@conduit/guardrails`).

## 3. Diagnose

**Harmful or wrong output.** Was a guardrail configured for that use case at all?
`gate_status: "unevaluated"` on the record means no guardrail ran, which is a
configuration gap, not an engine failure. If a guardrail did run and passed, the
signal set is wrong for that failure and step 4 is the real fix.

**Injection got through.** Where did the text enter? The input screen covers
what the user typed. A tool result is screened and enveloped in the agent loop
(`packages/agent/src/loop.ts`). If it entered any other way, that path has no
screen and that is the finding.

**Wrong refusals.** Read the ledger by pattern. If one pattern dominates, that
pattern is the bug, not the user. Add the exact refused input to the benign band
of the golden set before touching the pattern, so the fix is measured rather than
believed.

## 4. Turn the incident into a permanent eval case

This is the step that makes the runbook worth having, and it is not optional. An
incident that produces only a fix produces a fix that will be reverted by someone
who does not know why it exists.

1. **Write the case the same day.** Add a row to
   `evals/dataset/guardrails.jsonl` (or `model-contract.jsonl` for a routing or
   parameter failure) with a stable id, the band it belongs to, the real input,
   and the action that SHOULD have been taken. Use the real text where you can;
   redact PII in place rather than paraphrasing, because a paraphrase quietly
   changes what is being tested.
2. **Watch it fail first.** Run `npx vitest run evals` before the fix lands. A
   case that has never failed against the real defect is not evidence that the
   defect is fixed. This repo has a standing example: the sampling parameter gap
   is asserted with `it.fails` so the gap cannot be silently forgotten and cannot
   silently stay broken.
3. **Then fix, and re-measure.** Record the new precision, recall, and false
   block rate in `evals/README.md` next to the run that produced them, and move a
   CI floor only if the measurement earned it. Never set a floor above what you
   measured.
4. **Record the decision.** One entry in `docs/DECISION_LOG.md`: what happened,
   what was rolled back, what the eval now covers, and what is still open. If the
   incident falsified a claim in `docs/SAFETY.md`, correct that claim in place
   with the correction visible, rather than editing it away.

## What this runbook does not cover

No paging rotation, no severity levels, no status page, and no on-call. The
gateway is built and not operated (`docs/DECISION_LOG.md`), so an escalation
policy would be describing a team that does not exist. When Conduit runs
somewhere for someone else, that section gets written and this line gets deleted.
