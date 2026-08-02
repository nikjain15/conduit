# Conduit safety

What is enforced in code today, what is measured, and what is still open. Claims
here name the file that backs them.

## Trust boundaries

**The guardrail floor now runs inside `resolve()`.** Fixed 2026-08-02.
`packages/inference/src/core.ts` calls `runGuardrails` on the one path every
request already takes: the injection screen before the model call, then PII, the
output schema, the confidence threshold, and the mandatory floors after it. A use
case whose profile carries a guardrails config is screened without the caller
remembering anything, and a refused request comes back as a typed result carrying
the reason, never as an opaque throw.

**The honest limit on that sentence.** `ResolveTask.guardrails` is optional, and
a task without it behaves exactly as before. That is what let the floor land
without breaking a caller, and it means screening is a property of a use case
that carries the config, not yet of every request in the system. Making it
non-optional is a separate, breaking change and has not been made.

The earlier version of this section claimed enforcement that did not exist:
between 2026-08-01 and 2026-08-02 it described the engine as protecting live
requests while `runGuardrails` had three callers, all of them tests, examples, or
the offline harness. The correction is recorded rather than edited away, because
the lesson generalises: reading what a module does is not evidence that anything
calls it.

Outside text enters through the input `resolve()` screens and through tool
results returned into the agent loop. Neither is trusted.

- **Input screening.** `packages/guardrails/src/injection.ts` runs a
  deterministic pattern set over the raw input covering instruction override,
  role override, developer mode, safety bypass, and exfiltration asks. Every hit
  names the pattern that matched, so a reviewer can see why a request was
  refused.
- **What this is not.** The module says so itself: it is a heuristic pattern
  screen, not a model and not a guarantee. It catches the common shapes of an
  attack. A novel phrasing that avoids the patterns passes.
- **The untrusted data envelope.** Closed 2026-08-02. Tool results are screened
  through the injection scanner and, if they survive, wrapped in a labelled,
  nonce-delimited envelope before they enter the transcript
  (`packages/guardrails/src/untrusted.ts`, applied in
  `packages/agent/src/loop.ts`). A result that fails the screen is withheld
  entirely and the model is told the source was refused, so it neither sees the
  payload nor invents a replacement. Before this, a tool result re-entered the
  transcript as an ordinary user turn and was never screened at all.
- **What the envelope is not.** A delimiter is not a security boundary. It is a
  labelling convention a model may or may not honour, and nothing in it stops a
  sufficiently well written document from talking a model out of the label. Two
  structural properties it does provide: the markers carry an unpredictable
  nonce so content cannot close its own envelope, and marker-shaped text inside
  the content is neutralised before wrapping. The layer that actually holds
  under a successful injection is the tool authority limit below.

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

`packages/guardrails/src/engine.ts` returns one of allow, redact, block, or
escalate, combining signals fail closed so the most severe outcome wins. A
mandatory floor whose eval key did not run blocks, because a floor that did not
run cannot be trusted.

`resolve()` runs the config in two phases, and the split is load bearing rather
than cosmetic. Only the injection screen reads the input, so it runs before the
model call and a refused request costs nothing. PII, the output schema, the
confidence threshold and the floors all read the answer, so they can only run
after it. Running the floors before the call would refuse every request that
declares one, because no eval has run yet; that is asserted in
`packages/inference/test/guardrail-floor.test.ts`.

A refusal is returned, never thrown: `ResolveResult.status` is one of served,
served_redacted, blocked, or escalated, and `ResolveResult.guardrail` names the
phase, the action, the reasons and the pattern that fired. A caller catching an
opaque error cannot tell a refusal from a 500 and will retry the one it should
not.

Rationale for making this a floor rather than a per call option, and what it
costs, is in `docs/adr/ADR-0001-mandatory-guardrail-floor.md`.

## Refusals, and the open hole

Over refusal is a product failure, not extra safety, so it is measured next to
the safety number rather than left to impression.

Measured on the 42 case golden set, run of 2026-08-02 (`evals/README.md`):

- Every attack is caught. Recall 1.00 (24 of 24), no injection case reaches allow.
- One safe input in nine is refused. Precision 0.92, false block rate 0.11.

Previous run, 2026-08-01, 35 cases: precision 0.83, false block rate 0.25. The
three fixes below are what moved it, and all three have shipped.

1. **Every refusal is recorded with the pattern that caused it.**
   `packages/guardrails/src/ledger.ts` counts refusals by pattern and by outcome,
   and `resolve()` writes the same reasons onto the decision record. False blocks
   are now countable rather than estimated. The ledger holds causes only, never
   request content, and it is in process and bounded: a host that wants them
   durable injects `GuardrailDeps.onBlock`.
2. **`developer_mode` and `role_override` no longer block alone.** They need a
   second signal: an adversarial cue ("unfiltered", "no restrictions", "skip the
   usual checks", "do not tell the user"), or a second independent weak pattern.
   A weak pattern with nothing behind it is allowed and the near miss is
   recorded. This removed two of the four false blocks and cost no recall.
3. **A use case can route a refusal to human review.**
   `guardrails.blockedRequestAction: "review"` turns a block into an escalation:
   the answer is still withheld and the floor still ran, but the request reaches
   a person instead of dying. Default stays "refuse", so nothing changed for a
   use case that has not opted in.

**Two false blocks remain, and they are the harder two.** `ben-06` (how to
display the current password policy to users) and `ben-10` (a reply telling a
customer we cannot bypass their restrictions) both fire strong patterns,
`exfiltration` and `safety_bypass`. Corroboration does not help: those patterns
must keep blocking alone. The last one is a reply *refusing* an unsafe action,
which the guard reads as asking for one, and fixing it needs a screen that can
tell a refusal from a request. That is a model, not a regex.

ADR-0001 named 0.10 as the false block rate at which the design should change.
The measured 0.11 sits just above that line. It has not been crossed, and it is
close enough that the next measurement decides it either way.

## Data handling

The guardrails engine masks email addresses, card like digit runs, and phone
numbers in served answers when the PII signal is on, or refuses the answer when
policy is block (`packages/guardrails/src/redact.ts`).

Retention windows per data type are written down in `docs/RETENTION.md` and
backed by code: `DecisionStore.purge` and `applyRetention` in
`services/gateway/src/metering.ts` enforce a 400 day window on decision rows, and
`DecisionStore.deleteTenant` erases one tenant completely. Both are REQUIRED
methods on the interface, so a durable backend cannot be written without a delete
path, which is precisely what was missing before.

Open, and stated in that document rather than glossed: the 30 day content window
is policy with no code behind it. The gateway store holds no prompt or answer
text at all, so purging it does not touch content; content lives in the inference
decision record written through an injected sink to a store this repo does not
own. Per user deletion inside a tenant is also unsupported, because no decision
row carries a user id and adding one has its own privacy cost.

## Security basics

- The gateway authenticates with bearer tokens and resolves a tenant per request,
  including on the MCP transport, which sits behind the same auth as `/v1`
  (`services/gateway/src/server.ts`).
- Tenant isolation is enforced in the decision store: a query for one tenant
  never sees another tenant's rows (`services/gateway/src/metering.ts`).
- Secrets are supplied by the host environment. No key is committed.
- CI runs a dependency audit and a secret scan on every pull request
  (`.github/workflows/ci.yml`, `security` job). The audit fails on any high or
  critical advisory that is not allowlisted; every allowlist entry carries a
  reason and an expiry date, and the expiry is enforced in code, so an aged out
  exception fails the build even when the audit is otherwise clean
  (`scripts/audit-check.mjs`, tested in `scripts/audit-check.test.mjs`).
- The secret scan looks for credential formats rather than the word "key"
  (`scripts/secret-scan.mjs`). High signal on purpose: a scanner that cries wolf
  gets muted, and a muted scanner is worse than none because it also removes the
  excuse to look. The cost is stated rather than hidden: a credential in a format
  it does not know will pass, and it reads the current tree, not history.
- **Open, and it needs the repository owner.** Dependabot is switched off for
  this repository, so nothing opens a pull request when a new advisory lands. CI
  only catches it on the next push. Enabling Dependabot alerts and security
  updates is a settings change only the owner can make.
- **Open, and honest about it.** Four advisories are allowlisted today, all in
  the console's vite and vitest toolchain, all fixed only by a major upgrade that
  hit a peer dependency conflict. They expire 2026-11-01. None is reachable from
  a shipped package or from the gateway; the reasoning per advisory is in
  `.github/security/audit-allowlist.json`.

## Incident response

`docs/INCIDENT_RESPONSE.md` holds the runbook: what to roll back first when a bad
prompt or a model change is live (prompt, then routing, then guardrail config,
then code, cheapest and most reversible first), how to preserve evidence before
the 30 day content window closes it, and how every incident becomes a permanent
eval case that is watched failing before the fix lands.

## Not reviewed

Rate limiting and abuse control at the gateway edge, and the behaviour of the
judge panel under adversarial input. Neither has a test or a measurement yet.

Injection through tool results now has both: cases `inj-11` to `inj-13` in the
golden set, and the loop tests in `packages/agent/test/loop.test.ts`. What is
still unmeasured there is whether a model honours the envelope when the payload
is subtle, which nothing in this repo can test without a live model.
