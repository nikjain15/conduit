# @conduit/guardrails

A fail-closed guardrails decision engine. It reads a use case's
`GuardrailsConfig` and returns one decision: `allow`, `redact`, `block`, or
`escalate`.

## Signals

- **injectionGuard**: a deterministic, pattern based prompt-injection and
  jailbreak screen over the input (`scanInjection`). Labelled heuristic. A hit
  blocks.
- **pii**: reuses `@conduit/evals` `pii_scan` to detect PII in the answer. On a
  hit it either masks the matches (`redact`) or refuses (`block`), per
  `guardrails.piiAction` (defaults to `redact`).
- **outputSchema**: when set, reuses `@conduit/evals` `json_schema` to validate
  the answer as JSON against the schema. A violation blocks.
- **hitlThreshold**: an injected confidence below the threshold escalates to a
  human in the loop.
- **floors**: mandatory eval keys that must be present in the context. A missing
  floor blocks, because a floor that did not run cannot be trusted.

## Combining

Signals combine fail-closed and the most severe action wins:
`block > escalate > redact > allow`. Every firing signal is recorded in
`reasons`, even when a more severe action wins. `redactedAnswer` is surfaced only
when `redact` is the final action.

## Usage

```ts
import { runGuardrails } from "@conduit/guardrails";

const decision = await runGuardrails(
  { pii: true, piiAction: "redact", injectionGuard: true, floors: ["pii-block"] },
  { input: userText, answer: modelText, presentEvalKeys: ["pii-block"] },
);
// decision.action, decision.reasons, decision.redactedAnswer
```

The `pii_scan` and `json_schema` methods are injectable via `deps` for testing;
they default to the `@conduit/evals` built-ins.
