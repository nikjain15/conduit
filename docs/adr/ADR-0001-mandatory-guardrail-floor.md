# ADR-0001: guardrails are a mandatory floor, not a per call option

Date: 2026-08-01
Status: accepted

## Context

Every product embedding Conduit needs the same protections: screen untrusted
input for injection, keep PII out of served answers, enforce the declared output
shape, and escalate low confidence decisions to a human. The question is where
those live and who can turn them off.

The alternative on offer is the ordinary one: expose the guardrails as helpers
and let each caller decide per request. That is what a thin SDK wrapper would do,
and it is what a reviewer suggests when they say the profile object is over
engineered and you should just call the provider SDK directly.

## Decision

Guardrails are a floor enforced by the engine, not a per call option.
`runGuardrails` combines every enabled signal fail closed, the most severe
outcome wins in the order block, escalate, redact, allow, and a mandatory floor
whose eval key did not run blocks rather than passes.

The same posture holds in the agent loop: a tool marked `sideEffecting` is
refused unless the run is explicitly invoked with `allowSideEffects: true`.
Default deny.

## Alternatives rejected

**Per call opt out.** Rejected because the caller who most wants to skip the
guard is the caller under deadline pressure, and an option that exists is an
option that gets used. A floor that can be lowered is not a floor.

**Guardrails as prompt instructions.** Rejected because prompt rules are
suggestions. The constraint has to sit below the model, in the interface, where
the dangerous call cannot be expressed rather than merely discouraged.

**No shared layer, each app implements its own.** Rejected because that is the
problem Conduit exists to solve. Four copies drift, and the drift is invisible
until one of them is wrong in production.

## What this costs

**Latency on every request.** The signals run on every call including the ones
that never needed them.

**Flexibility.** A caller with a genuine reason to skip a signal has to change
the use case profile rather than pass a flag, which is deliberate friction.

**False blocks, and this is the real cost.** The injection screen is a
deterministic pattern set, and patterns over natural language over fire. Measured
on the golden set, the guard catches every attack (recall 1.00) and wrongly
refuses four of sixteen safe business inputs (precision 0.83, false block rate
0.25). A doc section named "Developer Mode", the phrase "you are now looking at
the Q3 figures", and a reply telling a customer we cannot bypass their
restrictions are all currently blocked.

**There is no recovery path for a wrongly blocked request.** The engine can
escalate to a human, but escalation is driven by a low confidence signal, and
block outranks escalate in the severity order. So a false block is terminal for
that request: the user is refused and the only fix is changing the rule and
redeploying. This is a genuine hole in the decision, recorded here rather than
argued away. See `docs/SAFETY.md` for the intended fix.

## What would change our mind

- The false block rate stays above 0.10 after the pattern set is tightened. At
  that point the guard is costing more user trust than it is buying safety, and
  a screen that escalates rather than blocks becomes the better design.
- A product embedding Conduit needs a legitimate per call exemption that cannot
  be expressed as a use case profile. That would mean the profile abstraction is
  wrong, not that the floor is wrong.

## Consequences

`evals/dataset/guardrails.jsonl` carries a `benign-hard` band of safe inputs that
resemble attacks, and `evals/gate.test.ts` gates precision and the false block
rate alongside recall. Safety and over blocking are measured together, so
tightening one cannot quietly wreck the other.
