# @conduit/guardrails

A fail-closed guardrails decision engine. It reads a use case's
`GuardrailsConfig` and returns one decision: `allow`, `redact`, `block`, or
`escalate`.

## Signals

- **injectionGuard**: a deterministic, pattern based prompt-injection and
  jailbreak screen over the input (`scanInjection`). Labelled heuristic. A hit
  blocks when the pattern is strong enough to act on alone. Two patterns,
  `developer_mode` and `role_override`, are weak: they match ordinary business
  language and need a second signal, either an adversarial cue or a second
  independent weak pattern. A weak pattern with nothing behind it is allowed and
  the near miss is recorded. That change took the measured false block rate from
  0.25 to 0.11 with no loss of recall (`evals/README.md`).
- **pii**: reuses `@conduit/evals` `pii_scan` to detect PII in the answer. On a
  hit it either masks the matches (`redact`) or refuses (`block`), per
  `guardrails.piiAction` (defaults to `redact`).
- **outputSchema**: when set, reuses `@conduit/evals` `json_schema` to validate
  the answer as JSON against the schema. A violation blocks.
- **hitlThreshold**: an injected confidence below the threshold escalates to a
  human in the loop.
- **floors**: mandatory eval keys that must be present in the context. A missing
  floor blocks, because a floor that did not run cannot be trusted.

## Recovery

`blockedRequestAction: "review"` turns a refusal into an escalation: the answer
is still withheld and the floor still ran, but the request routes to a human
instead of dying. Default is `"refuse"`, so the floor is not lowered by the
option existing. Without it a wrongly refused request has no path forward short
of editing the pattern set and redeploying.

## Recording

Every refusal is written to an in-process ledger with the pattern that caused it
(`ledger.ts`), so false blocks are countable rather than estimated. The ledger
holds causes only, never request content: it records the signal, the pattern
labels, the outcome, and optional use case and tenant labels. It is bounded (the
most recent 500 events) and lost on restart, so it is a source of counts, not a
store of record. `GuardrailDeps.onBlock` is the seam for anything durable, and a
sink that throws cannot change a safety decision.

## Untrusted data

`screenAndWrapUntrusted` screens external text (a tool result, a fetched page, a
retrieved chunk) and wraps what survives in a labelled, nonce-delimited envelope
before it reaches a model. `packages/agent/src/loop.ts` applies it to every tool
result.

Read `untrusted.ts` before relying on it. A delimiter is not a security boundary:
it is a labelling convention a model may or may not honour. The two things the
envelope structurally guarantees are that content cannot close its own envelope
(the nonce is unpredictable) and that marker-shaped text inside the content is
neutralised. The layer that holds under a successful injection is the agent
loop's authority limit, not the label.

## Combining

Signals combine fail-closed and the most severe action wins:
`block > escalate > redact > allow`. Every firing signal is recorded in
`reasons`, even when a more severe action wins. `redactedAnswer` is surfaced only
when `redact` is the final action.

## Usage

Most callers should not call this directly. `resolve()` in `@conduit/inference`
runs it on every request whose profile carries a guardrails config, splitting the
signals across the model call: the injection screen before it, the answer signals
after it. Calling the engine yourself is for a path that does not go through
`resolve()`.

```ts
import { runGuardrails } from "@conduit/guardrails";

const decision = await runGuardrails(
  { pii: true, piiAction: "redact", injectionGuard: true, floors: ["pii-block"] },
  { input: userText, answer: modelText, presentEvalKeys: ["pii-block"] },
);
// decision.action, decision.reasons, decision.redactedAnswer
```

Through the request path instead:

```ts
const result = await resolve(
  { ...task, guardrails: profile.guardrails, guardrailContext: { presentEvalKeys } },
  ctx,
);
if (result.status !== "served") {
  // result.guardrail names the phase, the action, and the pattern that fired.
}
```

The `pii_scan` and `json_schema` methods are injectable via `deps` for testing;
they default to the `@conduit/evals` built-ins.
