/**
 * The block ledger: every refusal, with the pattern that caused it.
 *
 * A guardrail that refuses without recording why cannot be audited, and a false
 * block that is not recorded cannot be counted. Before this existed the false
 * block rate could only be estimated offline against a hand written set; with it
 * the same figure can be computed from what the guard actually did in a process.
 *
 * Deliberately small and dependency free:
 *
 *  - It is IN PROCESS and NOT durable. A restart loses it. It exists so a host
 *    can read counts and ship them onward (a log line, a metric, a row), not as
 *    a store of record. Anything durable belongs behind `GuardrailDeps.onBlock`,
 *    which receives the same event.
 *  - It is BOUNDED. The event ring holds the most recent `MAX_EVENTS`; the
 *    per-pattern counters are cumulative and never truncated, because the counts
 *    are the point and the individual events are only for triage.
 *  - It records NO request content. Patterns, signal, action, and the optional
 *    use case and tenant labels only. A ledger that quoted the blocked input
 *    would become the most sensitive store in the system.
 */

/** What the guard did with the request that produced this event. */
export type BlockOutcome =
  /** Refused outright. */
  | "blocked"
  /** Would have been refused; the use case routes refusals to a human instead. */
  | "routed_to_review"
  /** A weak signal fired but was not corroborated, so the request was allowed.
   *  Recorded because the near misses are how the pattern set gets tuned. */
  | "held_for_corroboration";

/** One recorded refusal (or near refusal). Contains no request content. */
export interface BlockEvent {
  at: number;
  /** The guardrail signal that argued for the refusal, e.g. "injectionGuard". */
  signal: string;
  /** The pattern labels that fired, e.g. ["developer_mode"]. Empty for signals
   *  that are not pattern based, such as a missing mandatory floor. */
  patterns: string[];
  outcome: BlockOutcome;
  useCase?: string;
  tenant?: string;
}

/** A point-in-time read of the ledger. */
export interface BlockLedgerSnapshot {
  /** Cumulative count per outcome. */
  totals: Record<BlockOutcome, number>;
  /** Cumulative count per pattern label, across every outcome. */
  byPattern: Record<string, number>;
  /** The most recent events, oldest first, capped at MAX_EVENTS. */
  recent: BlockEvent[];
}

const MAX_EVENTS = 500;

let events: BlockEvent[] = [];
const totals: Record<BlockOutcome, number> = {
  blocked: 0,
  routed_to_review: 0,
  held_for_corroboration: 0,
};
const byPattern = new Map<string, number>();

/** Record one refusal. Called by the engine; safe to call from a host too. */
export function recordBlockEvent(event: BlockEvent): void {
  totals[event.outcome] = (totals[event.outcome] ?? 0) + 1;
  for (const p of event.patterns) byPattern.set(p, (byPattern.get(p) ?? 0) + 1);
  events.push(event);
  if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
}

/** Read the ledger. Returns copies, so a caller cannot mutate the counters. */
export function blockLedgerSnapshot(): BlockLedgerSnapshot {
  return {
    totals: { ...totals },
    byPattern: Object.fromEntries(byPattern),
    recent: events.map((e) => ({ ...e })),
  };
}

/**
 * The share of refusals that were later judged wrong.
 *
 * The ledger cannot know this on its own: whether a block was correct is a human
 * label, supplied here. Given the ids or patterns a reviewer marked as wrong, it
 * returns the false block rate over recorded refusals, which is the production
 * counterpart of the offline number in `evals/README.md`.
 */
export function falseBlockRate(wrongPatternHits: number): number {
  const refusals = totals.blocked + totals.routed_to_review;
  return refusals === 0 ? 0 : wrongPatternHits / refusals;
}

/** Clear the ledger. For tests and for a host that has flushed the counts on. */
export function resetBlockLedger(): void {
  events = [];
  totals.blocked = 0;
  totals.routed_to_review = 0;
  totals.held_for_corroboration = 0;
  byPattern.clear();
}
