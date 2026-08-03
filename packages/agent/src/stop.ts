/**
 * Stop conditions for the reason-act loop: what ends a run besides the model
 * deciding it is done.
 *
 * WHY THIS FILE EXISTS. Until 2026-08-02 `runAgent` had exactly one bound, a
 * step cap, and the loop returned a bare `stoppedAtCap: boolean`. A step cap
 * alone bounds the number of model turns and nothing else. It does not bound
 * what a run COSTS, because one step against a long transcript can cost more
 * than twenty short ones, and it does not notice a run that is making the same
 * call over and over: twelve identical steps and twelve productive steps are
 * the same number to a counter. Both of those end the same way, as a bill
 * nobody predicted or a run that burns its whole cap achieving nothing.
 *
 * So there are three bounds now, and each one names itself when it trips:
 *
 *   max_steps         the model turn cap (unchanged)
 *   budget_exhausted  a token and/or USD ceiling for the whole run
 *   loop_detected     the run reached a state it had already been in
 *
 * Every one of them returns partial results plus a notice saying how far the
 * run got, never a silent truncation and never an exception. `stopNotice`
 * below is that text, and it lives here rather than in the caller so the three
 * paths cannot drift into three different tones.
 *
 * Pure: no IO, no clock, no model. The loop injects what it measured.
 */

/** Why a run ended. `final_answer` is the only one that is not a bound. */
export type StopReason = "final_answer" | "max_steps" | "budget_exhausted" | "loop_detected";

/**
 * A ceiling for one run. Both fields are optional and independent: set either,
 * both, or neither. Neither means only the step cap applies, which is the
 * pre-2026-08-02 behaviour and the default, so existing callers are unchanged.
 */
export interface RunBudget {
  /** Total input + output tokens across every model turn in the run. */
  maxTokens?: number;
  /** Total USD across every model turn in the run. */
  maxCostUsd?: number;
}

/** What one model turn reported it consumed. Absent fields count as zero. */
export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * Cost of this turn in USD. The loop does not compute this: pricing lives in
   * `@conduit/inference` (`computeCost`), and the injected `callModel` is what
   * knows which model it actually called. A turn that reports no cost adds
   * zero, which is why a USD budget with a `callModel` that never reports cost
   * can never trip. That is stated rather than silently tolerated: see
   * `budgetGaps` below.
   */
  costUsd?: number;
}

/** Running total across a run. */
export interface Spend {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Model turns that reported no usage at all. */
  unmeasuredTurns: number;
}

export const ZERO_SPEND: Spend = {
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  unmeasuredTurns: 0,
};

/** Fold one turn's usage into the running total. Pure; returns a new Spend. */
export function addUsage(spend: Spend, usage: TurnUsage | undefined): Spend {
  if (!usage) {
    return { ...spend, unmeasuredTurns: spend.unmeasuredTurns + 1 };
  }
  const measured =
    usage.inputTokens !== undefined || usage.outputTokens !== undefined || usage.costUsd !== undefined;
  return {
    inputTokens: spend.inputTokens + (usage.inputTokens ?? 0),
    outputTokens: spend.outputTokens + (usage.outputTokens ?? 0),
    costUsd: spend.costUsd + (usage.costUsd ?? 0),
    unmeasuredTurns: spend.unmeasuredTurns + (measured ? 0 : 1),
  };
}

export const totalTokens = (spend: Spend): number => spend.inputTokens + spend.outputTokens;

/**
 * Which budget limit the spend has reached, or null if it is still inside.
 *
 * Checked AFTER each turn is folded in, so the budget is a ceiling on what a
 * run is allowed to have spent, not a prediction of the next turn. A run can
 * therefore finish one turn over the line; it cannot start another. Bounding
 * it the other way would need a per-turn cost estimate, which is a guess, and
 * this file does not trade a measured number for a guessed one.
 */
export function budgetBreach(spend: Spend, budget: RunBudget | undefined): string | null {
  if (!budget) return null;
  if (budget.maxTokens !== undefined && totalTokens(spend) >= budget.maxTokens) {
    return `token budget: ${totalTokens(spend)} of ${budget.maxTokens} tokens used`;
  }
  if (budget.maxCostUsd !== undefined && spend.costUsd >= budget.maxCostUsd) {
    return `cost budget: $${spend.costUsd.toFixed(4)} of $${budget.maxCostUsd.toFixed(4)} used`;
  }
  return null;
}

/**
 * Whether a declared budget can actually be enforced against what was measured.
 *
 * A USD ceiling with a `callModel` that never reports `costUsd` is not a
 * budget, it is a decoration: it can never trip however long the run goes. The
 * loop surfaces this on the result instead of letting a caller believe they are
 * protected. Returns the reasons it is unenforceable; empty means it is real.
 */
export function budgetGaps(spend: Spend, budget: RunBudget | undefined): string[] {
  if (!budget) return [];
  const out: string[] = [];
  if (spend.unmeasuredTurns > 0) {
    out.push(
      `${spend.unmeasuredTurns} model turn(s) reported no usage, so the budget did not see them`,
    );
  }
  if (budget.maxCostUsd !== undefined && spend.costUsd === 0 && totalTokens(spend) > 0) {
    out.push(
      "a USD budget is set but no turn reported costUsd, so the cost ceiling cannot trip",
    );
  }
  return out;
}

/**
 * A stable key for "the run has been here before".
 *
 * The state is the tool call TOGETHER WITH what it returned, not the call
 * alone. That distinction is the whole design. Calling the same tool with the
 * same arguments twice is not necessarily a loop: a fetch of a page that
 * changed, or a poll that is waiting for something, legitimately repeats and
 * legitimately returns something new each time. What cannot be productive is
 * an identical call returning an identical result, because the next turn then
 * sees the same transcript content it saw before and has no new information to
 * act on. That is a fixed point, and it will repeat until the step cap.
 *
 * So a repeated (call, result) pair halts, and a repeated call with a moving
 * result does not. Keying on the call alone would false-halt every poller.
 *
 * The three parts are joined with NUL (written as a backslash-u escape rather than
 * a literal byte, or git would classify this file as binary). A printable
 * separator can occur inside the JSON either side of it, which would let two
 * different states collide on one key and halt a run that was making progress.
 * NUL cannot appear in `JSON.stringify` output, so the split is unambiguous.
 */
export function stateKey(tool: string, args: unknown, result: unknown): string {
  return `${tool}\u0000${canonical(args)}\u0000${canonical(result)}`;
}

/**
 * Order-insensitive JSON, so `{a:1,b:2}` and `{b:2,a:1}` are one state rather
 * than two. `JSON.stringify` preserves insertion order, and a model that emits
 * the same arguments with the keys in a different order would otherwise slip
 * past the check.
 */
function canonical(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return "[circular]";
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, val]) => [k, walk(val)]));
  };
  try {
    return JSON.stringify(walk(value)) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * What the user sees when a bound trips.
 *
 * One function for all three so a stopped run always reads the same way: what
 * ended it, why, and that what came back is partial rather than final. AG2's
 * requirement is that each limit has a defined user-visible outcome, and a
 * defined outcome that only exists as a boolean on a result object is not one.
 */
export function stopNotice(reason: StopReason, detail: string, stepsTaken: number): string {
  const far = `Here is how far I got: ${stepsTaken} step${stepsTaken === 1 ? "" : "s"} completed, and the trace below is what I found.`;
  switch (reason) {
    case "final_answer":
      return "";
    case "max_steps":
      return `Stopped at the step limit (${detail}) without reaching a final answer. ${far}`;
    case "budget_exhausted":
      return `Stopped because this run reached its ${detail}. ${far}`;
    case "loop_detected":
      return `Stopped because the run repeated itself: ${detail}. Continuing would have produced the same result until the step limit. ${far}`;
  }
}
