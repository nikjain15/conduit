# ADR-0001: guardrails are a mandatory floor, not a per call option

Date: 2026-08-01
Status: accepted, and implemented on the request path since 2026-08-02

## Two corrections, both kept

**2026-08-02, morning. This ADR was wrong about the present tense.** As first
written it described the floor as in force. `runGuardrails` had three callers:
its own unit tests, its README example, and the offline eval harness. Neither
`services/gateway/src/handlers.ts` nor `resolve()` imported guardrails at all, so
no live request passed through the engine.

That inverted this ADR's own argument. It rejected a per call opt out on the
grounds that an option which exists is an option that gets used. A floor a caller
must remember to wire is weaker still: it is an opt IN, and the default is no
protection.

**2026-08-02, same day. Fixed.** `resolve()` in
`packages/inference/src/core.ts` now calls `runGuardrails` directly: the
injection screen before the provider call, then PII, the output schema, the
confidence threshold and the mandatory floors after it. A refusal returns a typed
`ResolveResult` carrying the phase, the action and the pattern that fired, rather
than throwing. `packages/inference/test/guardrail-floor.test.ts` proves it
through the shipped entry point rather than by calling the engine directly, which
is the only kind of test that would have caught the original error.

**What is still true and should not be overclaimed.** `ResolveTask.guardrails` is
optional. A task without it behaves exactly as it did before, which is what let
this land without breaking a caller, and it means the floor covers every use case
whose profile carries the config rather than every request in the system. That is
a weaker statement than "enforced", and it is the accurate one. Making the field
required is a separate, breaking change.

The cost of the import is recorded too: `core.ts` was written with no internal
imports so it could be bundled for Workers, Deno and Node without extension
conflicts. It now has exactly one. That was judged worth it, because the
alternative is the opt in this ADR exists to reject.

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

Guardrails are a floor enforced by the engine rather than a per call option, and
`resolve()` is where the engine is called. The engine implements the combining: `runGuardrails` combines every enabled
signal fail closed, the most severe
outcome wins in the order block, escalate, redact, allow, and a mandatory floor
whose eval key did not run blocks rather than passes.

The same posture holds in the agent loop, which was wired first and is still the
clearest example: `packages/agent/src/loop.ts` refuses a tool marked `sideEffecting` unless the run
is invoked with `allowSideEffects: true`. Default deny, enforced in the shipped
loop rather than in a module a caller may forget. It was the working example of
what this ADR intended for guardrails, and it stayed the only one for a day.

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
on the golden set at 2026-08-01: recall 1.00, precision 0.83, false block rate
0.25, four of sixteen safe business inputs refused. After requiring a second
signal before refusing on `developer_mode` or `role_override`, measured again at
2026-08-02 over 42 cases: recall 1.00, precision 0.92, false block rate 0.11. Two
false blocks remain, both firing strong patterns that must keep refusing alone.

**A wrongly blocked request now has a recovery path, per use case.**
`guardrails.blockedRequestAction: "review"` turns a refusal into an escalation:
the answer is still withheld and the floor still ran, but the request reaches a
human instead of dying. Default is "refuse", so the floor is not lowered by
existing. Before this, a false block was terminal and the only fix was changing
the rule and redeploying.

## What would change our mind

- The false block rate stays above 0.10 after the pattern set is tightened. At
  that point the guard is costing more user trust than it is buying safety, and
  a screen that escalates rather than blocks becomes the better design.
  **Status: 0.11 as of 2026-08-02.** Tightening moved it from 0.25 and left it
  just above the line rather than under it. The line has not been crossed and it
  has not been cleared either; the next measurement decides. Recorded here
  because a threshold you only check when it flatters you is not a threshold.
- A product embedding Conduit needs a legitimate per call exemption that cannot
  be expressed as a use case profile. That would mean the profile abstraction is
  wrong, not that the floor is wrong.

## Consequences

`evals/dataset/guardrails.jsonl` carries a `benign-hard` band of safe inputs that
resemble attacks, and `evals/gate.test.ts` gates precision and the false block
rate alongside recall. Safety and over blocking are measured together, so
tightening one cannot quietly wreck the other.
