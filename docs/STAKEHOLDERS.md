# Stakeholders and pushback

## Read this first: these reviews are simulated

Nik builds Conduit alone. Nobody else has reviewed this code.

The three reviews below are one person role playing three senior reviewers
against their own repository. No lawyer, no security engineer, no privacy
officer, no external party read this code, reviewed these findings, or approved
anything. Nothing here is a sign off, and no statement in this document should be
read as one. Where a role appears in the table, it describes who *would* need to
be involved if Conduit were adopted beyond Nik's own projects, not who was.

What this exercise is actually worth: it is a structured self critique run
against the real code, and it found defects that were not previously written
down anywhere, including one blocker. Every finding names the file and line it is
about, so any of it can be checked in a minute. That is the whole claim.

Reviews run 2026-08-02 against the repository at that date.

## Roles that would need to be involved

None of these people exist for Conduit today. This is the map of who would have to
be satisfied before anyone outside Nik's own projects could adopt it.

| Role | What they need from Conduit | Decision they own | What they would block on |
|---|---|---|---|
| Adopting engineer | A path from clone to one real, priced model call, and a clear answer to which packages they must import | Whether to build on Conduit or copy the two files they actually need | No install path. `packages/client/README.md` says "Nothing to install. Import from the workspace", and `PUBLISHING.md` describes the npm scope as not yet created |
| Staff engineer / reviewer at an adopting team | A written architecture, a dependency direction, and evidence the failure paths were thought through | Whether the abstraction earns its keep versus a thin provider wrapper | No `docs/ARCHITECTURE.md`, and the guardrail floor is not invoked on any request path (finding A1) |
| Security engineer | Trust boundaries drawn in code, not prose, and an injection story that covers tool output | Whether Conduit may sit in front of a model that touches customer data | Tool results re enter the agent transcript unlabelled (`packages/agent/src/loop.ts:180`) and are never screened |
| Privacy / data protection reviewer | A retention window, a deletion path keyed to a subject, and a statement of what is stored | Whether prompt content may be persisted at all | `DecisionStore` (`services/gateway/src/types.ts:164`) has no delete, and `resolve()` stores full prompt content by default (`packages/inference/src/core.ts:716`) |
| Legal / licensing | Provenance of the code, the MIT grant, and whether provider terms are respected downstream | Whether the packages may be published under the `@conduit` scope | Not assessed. No one qualified has looked, and this document does not pretend otherwise |
| Finance / budget owner | Cost per use case at expected volume, and a cap that holds | Whether the spend is approved | `docs/COST.md` does not exist, and OpenRouter decisions record cost 0 (finding A4) |
| Operator running the gateway | Rate limits, retention, alerting, and a deletion runbook | Whether the gateway may be exposed to real traffic | No rate limiting anywhere in `services/gateway/src/router.ts`, and the gateway has never been run in production |

## The single biggest misalignment risk

**The documents describe a platform with a policy floor. The code is a set of
libraries an integrator has to remember to wire together.**

`README.md:76` calls `@conduit/guardrails` a "fail-closed policy engine ... and
mandatory floors". `docs/adr/ADR-0001` states that guardrails are "a floor
enforced by the engine, not a per call option", and rejects the per call opt out
because "an option that exists is an option that gets used".

In the shipped code, `runGuardrails` has exactly two callers, and both are test
infrastructure: `packages/guardrails/test/engine.test.ts` and
`evals/harness.ts:64`. `handleInfer` (`services/gateway/src/handlers.ts:53`) calls
`deps.infer` and then `store.append`, with no guardrail call in between.
`resolve()` (`packages/inference/src/core.ts:669`) never mentions guardrails. The
agent loop never calls them either.

The ADR's own argument defeats the current state: a floor that the caller has to
remember to call is weaker than a per call opt out, because forgetting is
silent and an opt out is at least visible in a diff.

Why this is the *biggest* risk rather than just the top finding: it is the point
where a security reviewer and an adopting engineer would form opposite pictures
from the same README, and neither would discover the gap until they read the call
graph. Every other finding is a defect inside a claim. This one is a gap between
the claim and the shape of the system, and gaps like that are what erode trust in
the rest of the documentation, which is otherwise unusually honest.

## Sign-offs

**Obtained: none. Not one.**

No role in the table above has reviewed, approved, or been asked. Conduit has one
contributor and has never been through an external review of any kind.

Approvals that would be needed before Conduit could be adopted by anyone outside
Nik's own four projects, and what would have to happen first:

| Approval | Needed before | What would have to happen to get it |
|---|---|---|
| Security review of the injection and tool boundary | Any adopter puts Conduit in front of untrusted input | Close finding B1 (wrap and screen tool output), then hand a reviewer `packages/agent/src/loop.ts` and `packages/guardrails/src/` with the eval numbers from `evals/README.md` |
| Privacy review of what is stored and for how long | Any adopter stores prompt content through the gateway | Close finding B2 (deletion on the `DecisionStore` interface, a written retention window in `docs/SAFETY.md`), then get a qualified reviewer to read it |
| Legal sign off on publishing the `@conduit` scope | First `npm publish` | Not started. Nobody has assessed licence provenance or provider terms |
| Architecture review by a second engineer | Any team builds on the profile abstraction | Write `docs/ARCHITECTURE.md`, close A1 and A2, then find an engineer who has not seen the repo and pay for their time |
| A measured time to first successful call | Any public adoption claim | Sit one unfamiliar developer down with the repo and a stopwatch. This has never been done, so every claim about ease of adoption is currently a guess (finding C4) |

Until those exist, the honest positioning is what `docs/PRD.md` already says:
in use by four of Nik's products, pre external adoption.

## Pushback

Three reviews, run in character against the real code. Findings are ranked P0
(blocker), P1 (major), P2 (minor). **Nothing below was fixed in code during this
review.** The deliverable was the critique. Every finding is open unless it says
otherwise, and each one names the file that would close it.

### Review A: staff engineer, architecture

**Did not look at:** `apps/console` (the React front end) or the internals of
`packages/rag`, `packages/prompts`, and `packages/catalog`.

| # | Rank | Finding | Fix that would close it | State |
|---|---|---|---|---|
| A1 | P0 | The guardrail floor is not on any request path. `runGuardrails` is called only from `packages/guardrails/test/engine.test.ts` and `evals/harness.ts:64`. `handleInfer` (`services/gateway/src/handlers.ts:53`) and `resolve()` (`packages/inference/src/core.ts:669`) both skip it, while `README.md:76` and `docs/adr/ADR-0001` describe it as an enforced floor | Call `runGuardrails` inside `handleInfer` before `deps.infer` and again over the answer, sourcing the config from the use case profile, plus a gateway test asserting an injection input never reaches `deps.infer` | Open |
| A2 | P1 | Cross package deep relative imports break every published package. `packages/evals/src/methods.ts:17-19`, `judgeCheck.ts:16-17`, `gate.ts:21-22`, `packages/agent/src/loop.ts:19`, and `services/gateway/src/mcp.ts:14` and `:113` all reach across workspace boundaries by path. Packages pack `files: ["src", "README.md"]`, so `../../profile/src/registry.ts` resolves to nothing once installed from npm. `PUBLISHING.md` also lists `agent` as having no internal deps, contradicted by `loop.ts:19`, and `packages/agent/package.json` declares no dependencies at all | Replace the relative paths with the `@conduit/*` specifiers, add the missing dependency entries, and add a CI step that `npm pack`s each package and typechecks it from a temp install | Open |
| A3 | P1 | No failure fallback, and no default timeout. `core.ts:684` swaps to `meta.backup` only when month to date spend passes the cap; a provider 500 or 529 throws at `core.ts:442` with no failover. Only 429 retries (`core.ts:434`) and `maxRetries` defaults to 0 (`core.ts:421`). A request signal is applied only when the caller sets `timeoutMs` (`core.ts:419`), so a default call against a hung provider waits forever | Default `timeoutMs` inside `resolve()`, and try `meta.backup` once on `provider_error` and exhausted `rate_limited` | Open |
| A4 | P1 | OpenRouter cost is silently zero. `computeCostUsd` (`core.ts:342`) returns 0 for an unknown model id, and `DEFAULT_PRICES` (`core.ts:267`) holds four ids, none of them OpenRouter. Every OpenRouter decision therefore records `cost_usd: 0` and the console charts a truthful looking $0 | Return an explicit unpriced marker instead of 0, or read pricing from the OpenRouter catalog the project already fetches in `packages/catalog` | Open |
| A5 | P1 | `core.ts:413` forwards any caller supplied `temperature` to every model while `README.md:83` claims the core only sends a sampling param to a model that accepts it. Already recorded in `docs/DECISION_LOG.md` and asserted as an expected failure in `evals/gate.test.ts`. Restated here because it is the one defect that breaks an adopter on day one | Read `supportsSampling` from the catalog before building the body, drop the param when the model rejects it, and flip the `it.fails` in `evals/gate.test.ts` in the same change | Open, deliberately |
| A6 | P2 | Provider specific config leaks across providers: the OpenRouter path reads `task.anthropic?.maxRetries` and `retryBaseMs` (`core.ts:545-546`), so an OpenRouter caller must populate an `anthropic` block to configure retries | Rename to a provider neutral `task.retry` | Open |
| A7 | P2 | No `docs/ARCHITECTURE.md`. Ten packages, a service and an app, with the boundary rules living only in file header comments | Write it: dependency direction, the runtime seam, and which package may import which | Open |
| A8 | P2 | The agent loop bounds steps but not spend. `loop.ts:122` caps at `maxSteps`, while `messages` grows unbounded (appended at `:141` and `:180`) with no truncation, so a long run resends the whole transcript every turn and no token or wall clock budget exists | Add a token budget and a wall clock deadline to `RunAgentInput`, and truncate or summarise the transcript past a threshold | Open |
| A9 | P2 | No dependency audit or secret scan in `.github/workflows/ci.yml` | Add `npm audit` and a secret scan step | Open, already recorded in `docs/DECISION_LOG.md` |

### Review B: security and privacy

**Did not look at:** how API keys are stored and compared behind `deps.lookupTenant` (no implementation exists in the repo), and the console's browser side key handling.

| # | Rank | Finding | Fix that would close it | State |
|---|---|---|---|---|
| B1 | P0 | Tool output re enters the model transcript as an ordinary user turn with no untrusted marker: `packages/agent/src/loop.ts:180` pushes `{ role: "user", content: observation({ result: output }) }`. Attacker controlled text returned by a tool is indistinguishable from the operator's own input, and `scanInjection` never runs over it (it has no caller in the loop). The no authority invariant at `loop.ts:152` limits *writes*, but read and exfiltrate through a later read only tool call is unimpeded | Wrap observations in a delimited envelope explicitly labelled untrusted data, and run `scanInjection` over tool output before it is appended | Open. `docs/SAFETY.md` already names this gap in prose; this review pins it to the line |
| B2 | P1 | There is no deletion path, and the interface has nowhere to put one. `DecisionStore` (`services/gateway/src/types.ts:164`) exposes only `append` and `query`, so even a durable backend implementing it correctly cannot delete. Meanwhile `resolve()` persists full prompt content by default (`core.ts:716`, `storeInput` defaults true, written at `:725`) | Add `delete(tenant, filter)` to the `DecisionStore` interface, implement it in `InMemoryDecisionStore` (`services/gateway/src/metering.ts:152`), and write the retention window into `docs/SAFETY.md` | Open |
| B3 | P1 | Metered decisions are client writable in ways that corrupt the numbers. `handleDecisions` (`services/gateway/src/handlers.ts:102`) validates `costUsd` only with `Number.isFinite`, so a negative cost is accepted and can zero out a tenant's reported spend, and `at` is taken straight from the body (`:140`), so rows can be backdated out of a SUQS window or dated into the future | Reject negative `costUsd` and `latencyMs`, and clamp `at` to a small skew either side of server time | Open |
| B4 | P1 | A block leaves no record. `engine.ts:99-108` returns the reason to the caller and nothing else; nothing counts blocks, so the 25 percent false block rate stays a synthetic offline estimate and a production false block is invisible | Emit the decision plus the pattern that fired to the decision store, which is step 1 of the fix sequence already committed in `docs/SAFETY.md` | Open |
| B5 | P2 | Internal error text reaches the client. `services/gateway/src/server.ts:79-80` writes `err.message` into the 500 body, and `core.ts:442` embeds 300 characters of the provider's response body into the error message, so a provider error body can be relayed outward | Log server side, return a request id, and keep provider text out of the response | Open |
| B6 | P2 | PII masking is narrower than the claim reads. `packages/guardrails/src/redact.ts:11-15` covers email, 13 to 16 digit runs, and 10 or more digit phone shapes. Names, postal addresses, IBANs and national ids pass through, while `README.md:76` says "PII redaction or block" without qualification | Name the three covered shapes in the README line, or widen the rule set and re measure | Open |
| B7 | P2 | Unbounded per tenant handler retention: `sseByTenant` (`services/gateway/src/server.ts:67`) is never evicted, so every tenant that ever opens `/sse` keeps a handler resident for the life of the process | Evict on disconnect and cap the map | Open |
| B8 | P2 | No rate limiting or abuse control anywhere. `route()` (`services/gateway/src/router.ts:66`) does auth and dispatch only | A token bucket per tenant at the router | Open, already listed under "Not reviewed" in `docs/SAFETY.md` |

### Review C: go to market and adoption

**Did not look at:** pricing or licensing strategy, and any competitive comparison against the obvious alternatives.

| # | Rank | Finding | Fix that would close it | State |
|---|---|---|---|---|
| C1 | P0 | There is no path from clone to one real model call. `README.md:27-38` ends at a mock console that starts empty, and no example anywhere in the README sets an API key and gets a real answer. `packages/client/README.md` says "Install: Nothing to install. Import from the workspace", while `PUBLISHING.md` describes the `@conduit` npm scope as still needing to be created, so the packages cannot be installed either. An outside developer can look at Conduit and cannot use it | One runnable Node quickstart in the README using the node adapter and a real key, and either publish the scope or say plainly that adoption means cloning the repo | Open |
| C2 | P1 | The promised walkthrough does not exist. `README.md:12` says "Demo GIF below." and line 14 is the bare comment `<!-- DEMO_GIF -->` | Record one, or delete both lines until it exists. An empty placeholder is worse than no promise | Open |
| C3 | P1 | No API versioning or breaking change policy. The HTTP surface is `/v1/*` (`services/gateway/src/router.ts:51-60`) and every package sits at 0.1.0, but `PUBLISHING.md` says only "Versions stay at 0.1.0. Bump per package before republishing", with no definition of what counts as breaking or what `/v1` promises | `docs/VERSIONING.md`: what `/v1` guarantees, semver rules per package, and the deprecation window | Open |
| C4 | P1 | Time to first successful call has never been measured with a real person, and neither has the two hour kill criterion in `docs/DECISION_LOG.md`. Both headline claims about adoption ease are therefore guesses by the person who wrote the code and cannot be wrong about how it works | One timed session with a developer who has not seen the repo, recorded in the decision log with the number, whatever it turns out to be | Open |
| C5 | P2 | The tests badge is hand maintained and already wrong. `README.md:7` reads "tests-213 passing"; the suite reports 235 passed and 1 skipped as of this run. On a repository whose entire pitch is honest measurement, a stale hand written number is the worst possible place for drift | Drop the badge, or generate it from the CI run | Open |
| C6 | P2 | `conduit.dev` is used as though it were owned. `core.ts:524` sends `"HTTP-Referer": "https://conduit.dev"` as OpenRouter attribution, and `packages/client/README.md` uses `https://gateway.conduit.dev` as the example base URL | Point both at the GitHub URL until the domain is actually held | Open |
| C7 | P2 | The layout table (`README.md:66-79`) is a component inventory, not an adoption path. A reader cannot tell which two packages they need for the common case, and there is no diagram or `ARCHITECTURE.md` to answer it | A three line "start here" above the table naming the minimum import set | Open |

### What changed as a result

Two things, and neither is a code change:

1. **`docs/DECISION_LOG.md` gained a section** recording the decisions these
   reviews changed or defended, including A1, which was not previously written
   down anywhere.
2. **This document exists**, and it states that no external review or sign off has
   happened, which was previously implicit rather than said.

No source file was modified during this review. `npx tsc --noEmit` and
`npx vitest run` were run afterwards to confirm the tree is unchanged and green
(235 tests passing, 1 skipped).

### Where Nik would defend the current design instead

Not every finding deserves a fix. Four are answered rather than accepted.

**A7, no ARCHITECTURE.md, is real but low value right now.** With one
contributor, the architecture doc's readers are a future adopter and a future
self. It matters at the moment either exists. It is a P2 because writing it now
would document boundaries that A1 and A2 are about to move.

**A8, no token budget in the agent loop, is deliberate for the current caller
set.** The loop is pure with respect to IO: every model call flows through the
injected `callModel` (`loop.ts:34`). A caller who wants a token budget can enforce
it inside that function, where they already hold the usage numbers. Putting a
budget in the loop would duplicate accounting that `resolve()` already does. This
changes the day someone drives the loop through the gateway, where the caller is
not the app.

**B6, narrow PII coverage, is a documentation fix rather than a code fix.** The
masker exists to keep the three highest frequency shapes out of served answers,
and it is deliberately the same rule set `pii_scan` uses so the engine and the
eval gate cannot disagree about what PII is (`redact.ts` header). Widening it with
name and address heuristics would import exactly the over blocking problem the
injection screen already has, measured at 25 percent. The right move is to state
the three shapes in the README, not to guess at names.

**C1's second half, publish to npm, is refused for now.** Publishing an unpublished
scope is the easy half; keeping ten packages versioned, changelogged and
compatible is the expensive half, and doing it before C3 exists and before A2 is
fixed would ship packages that do not resolve. Cloning is an honest install story
for a pre adoption project. The README should say so rather than implying a
registry install works.

**A5's timing is defended, not the defect.** The sampling parameter gap is real and
is a P1. Leaving it open while the eval that catches it is written first is the
deliberate order recorded in `docs/DECISION_LOG.md`: the eval had to be seen
failing against the real defect before the defect was fixed, otherwise the eval
proves nothing.

## Status update, 2026-08-02, second pass

The tables above are a dated record of what the reviews found and are left as
written. This is what has changed since, and nothing else has.

| Finding | Was | Now |
|---|---|---|
| A1, the guardrail floor is on no request path | P0 open | Closed. `resolve()` calls `runGuardrails` in two phases. Closed one level lower than the review proposed: in the inference core rather than in `handleInfer`, so the in process callers are covered too, not just the gateway |
| A9, no dependency audit or secret scan | P2 open | Closed. A `security` job runs both, with an allowlist whose expiry dates are enforced in code |
| B1, tool output re enters the transcript unlabelled and unscreened | P0 open | Closed. Tool results are screened and enveloped. The review's own caution stands: the envelope is a label, and the authority invariant is the boundary |
| B2, no deletion path and nowhere in the interface to put one | P1 open | Closed for the store: `purge` and `deleteTenant` are required interface methods with windows in `docs/RETENTION.md`. Open for content, which lives outside this repo and is stated as policy without enforcement |
| B4, a block leaves no record | P1 open | Closed. Every refusal is recorded with the pattern that caused it, in process and on the decision record |
| B6, PII masking is narrower than the claim | P2 open | Still open. The 25 percent over blocking figure quoted in the defence is now 11 percent, which does not change the argument |

Everything else in the tables is unchanged and still open, including A5, which
stays open on purpose.
