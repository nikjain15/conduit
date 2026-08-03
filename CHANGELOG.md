# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest first.

Every entry names the surface it touches, **HTTP** (`/v1`) or **packages** (`@conduit/*`), and
whether it is breaking under `docs/VERSIONING.md`. A breaking entry carries a migration note with
the old shape and the new one side by side.

Nothing here is released yet: no `@conduit/*` package has been published and no gateway instance
runs. Dates are commit dates.

## Unreleased

### Added

- **HTTP, additive.** `AgentResult.stopReason` and `AgentResult.notice`, both optional. A stopped
  agent run now says why it stopped and what the caller should show, instead of returning a partial
  answer indistinguishable from a complete one. Optional on purpose: a core that predates stop
  conditions still satisfies the type, so this is not breaking. (ADR-0002)
- **Packages, additive.** `@conduit/agent` gains `RunBudget`, `Spend`, `StopReason`, `TurnUsage`,
  and the pure helpers `addUsage`, `budgetBreach`, `budgetGaps`, `stateKey`, `stopNotice`,
  `totalTokens`, `ZERO_SPEND`. `RunAgentInput` gains optional `budget` and `detectLoops`;
  `RunAgentResult` gains `stopReason`, `notice`, `spend`, `budgetEnforceable`.
- **Packages, additive.** `@conduit/profile`: `AgentConfig` gains optional `budget` and
  `detectLoops`; `RunConfiguredResult` carries the stop fields through.
- `docs/VERSIONING.md`, the breaking-change policy, and `scripts/check-api-surface.mjs`, the CI
  gate that enforces it against a committed snapshot in `docs/api-surface.json`.

### Changed

- **Behaviour, not a type change.** Agent loop repeated-state detection defaults **on**. A run that
  reaches a `(tool, args, result)` state it has already been in now halts with
  `stopReason: "loop_detected"` instead of burning the remaining step cap. Opt out with
  `detectLoops: false`. All 285 pre-existing tests pass unchanged with it on.
- `RunAgentResult.stoppedAtCap` still exists and still means what it did. It is now exactly
  `stopReason === "max_steps"`. Not deprecated, not removed; `stopReason` is simply more precise,
  because it separates running out of steps from running out of money or going in circles.

### Fixed

- Missing-price fallback billed unpriced models at **zero** rather than failing loudly, so a model
  absent from the price table looked free. Prices were audited across all five products on
  2026-08-02; Conduit's rates were correct and only this fallback was wrong.
