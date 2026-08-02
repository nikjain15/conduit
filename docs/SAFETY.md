# Conduit safety

What is enforced in code today, what is measured, and what is still open. Claims
here name the file that backs them.

## Trust boundaries

**Read this first: the guardrail engine is not on any request path today.**
`runGuardrails` is called only by its own tests, its README example, and the
offline eval harness. The gateway and `resolve()` do not import it. So the
screening described below is a capability this repo ships and a caller must wire,
not a protection any live request currently receives. Corrected 2026-08-02 after
a review found the earlier wording claimed enforcement that does not exist. The
fix is to call it inside `resolve()`, which every request already passes through.

What follows describes what the engine does when it is called.

Outside text enters through the input a caller passes to `runGuardrails` and
through tool results returned into the agent loop. Neither is trusted.

- **Input screening.** `packages/guardrails/src/injection.ts` runs a
  deterministic pattern set over the raw input covering instruction override,
  role override, developer mode, safety bypass, and exfiltration asks. Every hit
  names the pattern that matched, so a reviewer can see why a request was
  refused.
- **What this is not.** The module says so itself: it is a heuristic pattern
  screen, not a model and not a guarantee. It catches the common shapes of an
  attack. A novel phrasing that avoids the patterns passes.
- **Open gap, two of them.** External text is screened but not structurally
  separated: nothing labels fetched or tool returned content as untrusted data
  before it reaches the model. Worse, in `packages/agent/src/loop.ts` a tool
  result re-enters the transcript as an ordinary turn and is never screened at
  all, so a document fetched by a tool can carry instructions straight into the
  next model call. An untrusted data envelope at that boundary is the single
  most valuable safety change left.

## Tool limits

The strongest guarantee in the codebase, and the one to press on.

`packages/agent/src/loop.ts` holds a no authority invariant: a tool declared
`sideEffecting: true` is refused unless the run is invoked with
`allowSideEffects: true`. Default deny. A refusal is fed back to the model as an
observation rather than thrown, so the model can choose a read only path instead
of the run dying.

This is an interface constraint, not a prompt rule. No wording in a prompt and no
jailbreak changes it, because the authority to act is not something the model is
asked about.

## Guardrail decisions

Again: this engine is not currently invoked by any request path. When called,
`packages/guardrails/src/engine.ts` returns one of allow, redact, block, or
escalate, combining signals fail closed so the most severe outcome wins. A
mandatory floor whose eval key did not run blocks, because a floor that did not
run cannot be trusted.

Rationale for making this a floor rather than a per call option, and what it
costs, is in `docs/adr/ADR-0001-mandatory-guardrail-floor.md`.

## Refusals, and the open hole

Over refusal is a product failure, not extra safety, so it is measured next to
the safety number rather than left to impression.

Measured on the 35 case golden set (`evals/README.md`):

- Every attack is caught. Recall 1.00, no injection case reaches allow.
- One in four safe inputs is refused. Precision 0.83, false block rate 0.25.

The four current false blocks are ordinary business requests, including a reply
that tells a customer we *cannot* bypass their restrictions, which the guard
reads as a request to bypass restrictions.

**A wrongly blocked request has no recovery path today.** The engine can escalate
to a human, but escalation fires on low confidence, and block outranks escalate
in the severity order. So a false block is terminal: the user is refused, nothing
routes to review, and the only remedy is editing the pattern set and redeploying.
Nothing records that it happened.

Intended fix, in order:

1. Record every block with the pattern that fired, so false blocks are countable
   in production instead of estimated offline.
2. Require a second signal before blocking on `developer_mode` or `role_override`
   alone, which are the two patterns responsible for the widest over reach.
3. Let a use case route a blocked request to human review instead of a hard
   refusal, so the floor stays on while the user keeps a path forward.

## Data handling

The guardrails engine masks email addresses, card like digit runs, and phone
numbers in served answers when the PII signal is on, or refuses the answer when
policy is block (`packages/guardrails/src/redact.ts`).

Open: there is no written retention window for the decision records the gateway
stores, and no deletion path by user id. The metering store keeps decisions
bucketed by tenant, so tenant scoped deletion is straightforward to add, but it
is not implemented and should not be claimed.

## Security basics

- The gateway authenticates with bearer tokens and resolves a tenant per request,
  including on the MCP transport, which sits behind the same auth as `/v1`
  (`services/gateway/src/server.ts`).
- Tenant isolation is enforced in the decision store: a query for one tenant
  never sees another tenant's rows (`services/gateway/src/metering.ts`).
- Secrets are supplied by the host environment. No key is committed.
- **Open:** CI runs typecheck, tests, and a console build. There is no dependency
  audit, no secret scan, and no automated alert for a vulnerable dependency.
  Adding `npm audit` and a secret scan to `.github/workflows/ci.yml` is the
  cheapest remaining security improvement.

## Not reviewed

Rate limiting and abuse control at the gateway edge, prompt injection reaching
the agent loop through tool results rather than the initial input, and the
behaviour of the judge panel under adversarial input. None of these have a test
or a measurement yet.
