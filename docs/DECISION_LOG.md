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

**CLOSED 2026-08-02: the guardrail floor is now wired to the request path.** The
entry below is kept in full, because the error it records is more useful than the
fix.

Found 2026-08-02 by an architecture review. `runGuardrails` had three callers:
its own tests, its README example, and the offline eval harness. Neither the
gateway handler nor `resolve()` imported guardrails, so no live request was
screened, while ADR-0001 and SAFETY.md, both written a day earlier, described the
floor as enforced. They described the engine's semantics accurately and never
checked its call sites.

The lesson generalises and is worth keeping: reading what a module does is not
evidence that anything calls it. Grep for call sites before writing "enforced".

Fixed the same day. `resolve()` calls `runGuardrails` in two phases: the
injection screen before the provider call, so a refused request costs nothing,
and PII, output schema, confidence and floors after it, because those read the
answer. A refusal returns a typed `ResolveResult` with a status and the pattern
that fired, rather than throwing. `packages/inference/test/guardrail-floor.test.ts`
asserts it through the shipped entry point, not by calling the engine, which is
the only kind of test that would have caught the original error.

Still true and not overclaimed: `ResolveTask.guardrails` is optional, so the
floor covers every use case whose profile carries the config rather than every
request in the system. Making it required is a separate, breaking change.

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

**PARTLY CLOSED 2026-08-02: guardrails over blocked one safe request in four.**
Measured, not guessed: precision 0.83 and a false block rate of 0.25 on the
golden set, against a recall of 1.00, with no recovery path for a wrongly blocked
request.

All three fixes from `docs/SAFETY.md` shipped: refusals are recorded with the
pattern that caused them, `developer_mode` and `role_override` need a second
signal before refusing, and a use case can route a refusal to human review.
Re-measured over 42 cases: precision 0.92, false block rate 0.11, recall
unchanged at 1.00. CI floors moved to 0.90 and a 0.15 ceiling in the same commit
as that run.

Still open: two false blocks remain, both firing strong patterns that must keep
refusing alone, and one of them is a reply *refusing* an unsafe action that the
guard reads as asking for one. Telling those apart needs a model rather than a
regex. ADR-0001 named 0.10 as the rate at which the design should change; 0.11 is
just above it, and the next measurement decides.

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

**CLOSED 2026-08-02: no dependency audit in CI.** A `security` job now runs
`npm audit` through `scripts/audit-check.mjs`, failing on any high or critical
advisory that is not allowlisted, plus a secret scan over tracked files. Every
allowlist entry carries a reason and an expiry, and the expiry is enforced in
code and tested, so an aged out exception fails the build even on a clean audit.

Two things this does not do, and the owner should know both. Dependabot is
switched off for this repository, so nothing opens a pull request when an
advisory lands between pushes; enabling it is a settings change only the owner
can make. And four advisories are allowlisted today, all in the console's vite
and vitest toolchain, expiring 2026-11-01: the fix is a major upgrade that hit a
peer dependency conflict and is a migration of its own rather than a line in a
security commit.

**Both of those closed, 2026-08-02, and the second one was wrong.**

Dependabot is now enabled. The first thing it reported was **ten open advisories,
two of them critical**, which is the precise cost of the gap described above: the
CI audit only fires on a push, so between pushes nothing was watching, and the
count had grown unseen. The gate itself was working correctly the whole time and
passing, because all four of the high and critical findings were allowlisted and
in date.

The allowlist reason is the part that did not survive checking. It said the fix
needs **vite 7 and vitest 3**, and that the upgrade hits a peer dependency
conflict with `@vitejs/plugin-react`. The reachability arguments attached to each
entry were sound and are worth reading in the git history: the vite dev server
never runs outside a developer machine, and the vitest UI server is never started
by any script here. The upgrade claim was not sound, and it was checkable on the
day it was written:

- The advisories are fixed in **vite 6.4.3**, not vite 7.
- The peer conflict belonged to `@vitejs/plugin-react` **4**. Version 5 peers
  `vite ^4 || ^5 || ^6 || ^7 || ^8`, so it disappears one major up.

What actually shipped: vite 5.4.10 to 6.4.3, vitest 2 to 3.2.7, plugin-react 4 to
5.2.0, and root `overrides` pulling `vite`, `@hono/node-server` and
`@modelcontextprotocol/sdk` past the versions their parents pin. `npm audit` goes
from ten advisories to **zero**, the allowlist is empty, the console still builds,
and all 275 tests still pass.

**The lesson, which is not about vite.** Dev-only reachability is a good argument
and it is not a reason to stop looking for a fix. These four entries sat behind an
unverified sentence about a major version, and no part of this mechanism could
have caught it, because an expiring allowlist only ever asks whether a reason is
still **in date**. It never asks whether the reason is still **true**. The expiry
would have forced a re-read on 2026-11-01; enabling Dependabot forced it in a day.
Those two controls answer different questions and this repo needed both.

## What the simulated stakeholder reviews changed, 2026-08-02

Three adversarial reviews (architecture, security and privacy, adoption) were run
against this repository on 2026-08-02. They were **simulated**: one person role
playing three reviewers against their own code. No external party reviewed or
approved anything. Full findings and ranks are in `docs/STAKEHOLDERS.md`.

No source file was changed by the reviews themselves. What changed first was what
is written down; the code changes below followed the same day, in a second pass,
and each entry says which.

**Changed: the guardrail floor is now recorded as unenforced on the request
path.** This is the P0 and it was not written down anywhere before.
`runGuardrails` has two callers in the tree, `packages/guardrails/test/engine.test.ts`
and `evals/harness.ts:64`, both test infrastructure. `handleInfer`
(`services/gateway/src/handlers.ts:53`) and `resolve()`
(`packages/inference/src/core.ts:669`) do not call it. `README.md:76` and
`docs/adr/ADR-0001` describe a mandatory floor. What shipped was a library
function an integrator had to remember to call, which by the ADR's own argument is
weaker than the per call opt out the ADR rejected.

**Closed the same day, one level lower than the review proposed.** The review said
call it inside `handleInfer`. It went into `resolve()` instead, because the
gateway handler is one caller of the inference core and the apps that embed
Conduit in process are the others; screening in the handler would have left the in
process path unscreened. The gateway is covered either way, since the `infer` core
it delegates to is `resolve()`. Test:
`packages/inference/test/guardrail-floor.test.ts` asserts the provider is never
reached on a refused input.

**Changed: the published packages do not resolve.** `packages/evals/src/methods.ts:17-19`,
`judgeCheck.ts:16-17`, `gate.ts:21-22`, `packages/agent/src/loop.ts:19` and
`services/gateway/src/mcp.ts:14` import across workspace boundaries by relative
path, while each package packs only its own `src`. `PUBLISHING.md` therefore
describes a publish that would produce broken tarballs, and its stated publish
order calls `agent` internally dependency free, which `loop.ts:19` contradicts.
Fixing it means workspace specifiers plus the missing dependency entries. Open,
and it moves ahead of publishing in priority.

**Changed, then CLOSED 2026-08-02: deletion was missing from the interface, not
just the implementation.** `DecisionStore` exposed only `append` and `query`, so
a durable backend had nowhere to hang a delete even if it wanted one.

`purge(before)` and `deleteTenant(tenant)` are now REQUIRED methods on the
interface, both implemented and tested, with the retention windows per data type
written down in `docs/RETENTION.md` and enforced by `applyRetention`.

Deliberately not closed, and said plainly in that document: the 30 day content
window is policy with no code behind it, because the gateway store holds no
prompt or answer text and content lives in a store this repo does not own. Per
user deletion inside a tenant is unsupported, because no row carries a user id
and adding one has its own privacy cost.

**Changed, then CLOSED 2026-08-02: the tests badge was wrong.** It claimed 213
passing against a suite of 235. Now 275 passed and 1 skipped, and the badge and
the layout section say 275. A hand maintained number on a project whose pitch is
honest measurement is worth the thirty seconds.

**Defended: no token budget in the agent loop.** Every model call flows through the
injected `callModel` (`packages/agent/src/loop.ts:34`), where the caller already
holds usage numbers, so a budget in the loop would duplicate accounting
`resolve()` already does. This is defended only while the caller is the app. It
stops holding the day the loop is driven through the gateway.

**Defended: narrow PII masking.** `packages/guardrails/src/redact.ts` deliberately
mirrors `pii_scan` so the engine and the eval gate cannot disagree about what
counts as PII. Widening it with name and address heuristics would import the same
over blocking failure the injection screen had at 25 percent, and still has at 11
percent. The fix is to state the three covered shapes in the README, not to guess
at names.

**Defended: not publishing to npm yet.** Publishing before the import paths are
fixed would ship packages that do not resolve, and before a versioning policy
exists it would create compatibility promises nobody has defined. Cloning is an
honest install story for a pre adoption project, and the README should say that
plainly instead of implying a registry install works.

**Defended: the order of the sampling parameter fix.** Still open, still a real
defect, still deliberately unfixed until the eval that catches it has been seen
failing against it.

## Second pass, 2026-08-02: the safety gaps the reviews found

Five changes, in the order they were worth doing. Each closed a gap that was
written down above rather than one discovered while typing.

1. **The guardrail floor runs on the request path.** Detail in the entry above.
2. **Untrusted data envelope.** Tool results were re-entering the agent
   transcript as ordinary turns, unscreened, so a fetched document could carry
   instructions into the next model call. They are now screened by the injection
   scanner and, if they survive, wrapped in a nonce-delimited envelope that
   labels them as data (`packages/guardrails/src/untrusted.ts`). A result that
   fails the screen is withheld and the model is told the source was refused, so
   it neither sees the payload nor invents a replacement. The comments and
   `docs/SAFETY.md` both say plainly that a delimiter is not a security boundary:
   the layer that holds under a successful injection is the tool authority
   invariant, not the label.
3. **False block recovery.** Detail in the entry above.
4. **Dependency and secret scanning in CI.** Detail in the entry above.
5. **Retention, deletion, and an incident runbook.** `docs/RETENTION.md` states a
   window per data type and names what enforces each one, including the one
   nothing enforces. `docs/INCIDENT_RESPONSE.md` gives the rollback order for a
   live bad prompt or model change, cheapest and most reversible first, and makes
   the last step turning the incident into a permanent eval case that is watched
   failing before the fix lands.

What was deliberately not done in this pass: the sampling parameter gap, which
stays open by choice (see above), and making `ResolveTask.guardrails` required,
which is a breaking change and belongs in its own commit with its own callers
updated.

## Scope cuts

- **The gateway is built and not operated.** Auth, tenant isolation and metering
  are implemented and tested; no instance runs. The console runs against a mock
  gateway that starts empty rather than showing invented data.
- **Hosted MCP over HTTP and SSE is designed, stdio is what runs.** Documented in
  `packages/mcp/docs/connecting-clients.md` as the hosted shape.
- **Prompt versioning exists; a staged rollout does not.** Prompts are versioned
  files, and a change must pass the eval gate, but there is no percentage rollout
  or automatic rollback.
