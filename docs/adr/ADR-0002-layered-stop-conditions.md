# ADR-0002: an agent run is bounded by three limits, not one

Date: 2026-08-02
Status: accepted, and implemented in `packages/agent/src/stop.ts` since 2026-08-02

## Context

`runAgent` had exactly one bound: `maxSteps`, a cap on model turns. The loop
returned `stoppedAtCap: boolean` and nothing else, and the header comment
described termination as "a final answer, or `maxSteps` model turns".

A step cap is a real bound and it is not enough, for two reasons that fail in
different directions.

**It does not bound cost.** Each step resends the transcript so far, and the
transcript grows with every observation, so step twelve can cost several times
step one. The cap fixes how many times you pay and says nothing about how much.
A run that stays inside its step budget can still produce a bill nobody
predicted, which is the cost incident AG2 exists to ask about.

**It does not notice a run achieving nothing.** Twelve productive steps and
twelve identical steps are the same number to a counter. An agent that asks the
same question over and over burns its entire cap and returns no answer, and the
only signal the caller gets is the same `stoppedAtCap: true` it would get from a
run that was genuinely making progress and merely ran out of room. Those are
different failures with different fixes, and one boolean cannot tell them apart.

## Decision

Three bounds, each of which names itself when it trips, and each of which has a
defined thing the user sees.

| Bound | What ends the run | What the user sees |
|---|---|---|
| `max_steps` | the model-turn cap, unchanged | "Stopped at the step limit… here is how far I got" |
| `budget_exhausted` | a token and/or USD ceiling for the whole run | "Stopped because this run reached its cost budget: $x of $y used… here is how far I got" |
| `loop_detected` | the run reached a state it had already been in | "Stopped because the run repeated itself… continuing would have produced the same result until the step limit" |

`RunAgentResult` carries `stopReason`, a user-facing `notice`, and the run's
`spend`. `stoppedAtCap` is kept and is now exactly `stopReason === "max_steps"`,
so callers written against the old shape are unchanged.

The notice text lives in one function, `stopNotice`, rather than at the three
call sites, so the three paths cannot drift into three different tones. Every
bound returns the partial trace. None of them throws, and none returns an empty
answer with no explanation attached.

### Why the loop state includes the tool's result

The obvious implementation of loop detection keys on the tool call: same tool,
same arguments, halt. That is wrong, and it is wrong in the direction that
breaks working systems. A poller calls the same tool with the same arguments on
purpose, and so does a fetch of a page that changes. Halting those is a
false positive that turns a correct agent into a broken one.

So the state is the call **together with what it returned**. An identical call
returning an identical result is a fixed point: the next turn sees the same
content it already saw, has no new information, and will propose the same thing
again until the step cap. An identical call returning something new is progress.
The first halts and the second does not, and `stop.test.ts` holds both cases,
including the poller explicitly.

### Why a repeated error is not a loop

Loop detection runs on the successful tool path only. A repeated validation
failure looks like a repetition and is not one: the error observation is
precisely the new information the model needs in order to correct itself.
Halting on the second identical schema failure would kill runs that were one
turn away from recovering. Tested.

### Why the budget is checked after the turn, not before

The budget is a ceiling on what a run is allowed to have spent, checked once a
turn has been charged and before another is bought. A run may therefore finish
one turn over the line; it may not start another.

Bounding it the other way would mean estimating the next turn's cost before
making the call. That estimate is a guess, and the alternative to a guess here
is a measurement taken one turn later. Preferring the measurement costs at most
one turn of overshoot and never reports a number nobody measured.

## What this does not claim

**The loop does not compute cost.** Pricing lives in `computeCost` in
`@conduit/inference`, and only the injected `callModel` knows which model it
actually called, so the budget can bound only what a turn reports on
`ModelTurn.usage`. A `maxCostUsd` set against a `callModel` that reports tokens
but no cost can never trip, however long the run goes.

That case is reported rather than tolerated. `RunAgentResult.budgetEnforceable`
comes back non-empty naming the gap, and a caller that ignores it is trusting a
bound that does not exist. This was the specific failure worth engineering
against: not an absent safeguard, which is visible, but a present one that
silently does nothing, which is not.

**No default budget ships.** `budget` is optional and unset by default, so every
existing profile behaves exactly as it did. Choosing a defensible default needs
a distribution of real run costs, and Conduit has no live traffic. A default
picked without that would be a number invented to look rigorous, which is the
one thing `docs/COST.md` is written to avoid.

**Loop detection defaults on.** That is a behaviour change, taken deliberately:
the failure it prevents is silent and expensive, the false-positive case is
addressed by keying on the result, and `detectLoops: false` is available for a
workload where an identical call returning an identical result is genuinely
productive. All 285 pre-existing tests pass unchanged with it on.

## Consequences

- `AgentConfig` gains `budget` and `detectLoops`, so a ceiling is declared per
  use-case profile rather than per call site.
- A non-positive ceiling is caught at resolve time and reported as a warning,
  because a `maxTokens: 0` would otherwise stop every run at its first turn and
  look like a broken agent rather than a broken config.
- `RunConfiguredResult` carries `stopReason`, `notice`, `spend` and
  `budgetEnforceable` through to the caller, so the console has something to
  show rather than an unexplained missing answer.

## Related

- `docs/COST.md` §Run budget, for what a step cap does and does not bound.
- ADR-0001, for the same argument in a different place: a safeguard that a
  caller must remember to wire is an opt-in, and the default is no protection.
