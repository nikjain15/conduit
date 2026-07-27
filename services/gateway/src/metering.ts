/**
 * Metering: the default in-memory decision store plus the pure aggregations
 * that build /v1/usage and /v1/suqs.
 *
 * `aggregateUsage` and `computeSuqs` are pure functions over a list of
 * decisions, so both endpoints are testable without any store. Every figure
 * they produce is derived from real recorded decisions: given no decisions they
 * return an explicit empty result, never an invented number.
 *
 * `InMemoryDecisionStore` is the batteries-included store used when a caller
 * does not inject a durable one. It keeps decisions bucketed by tenant so a
 * query for one tenant never sees another tenant's rows. A durable store drops
 * in behind the same `DecisionStore` interface: `append` becomes an INSERT and
 * `query` a tenant-scoped SELECT over `at` and `useCase`.
 */
import type {
  Decision,
  DecisionQuery,
  DecisionStore,
  SloTarget,
  SuqsApp,
  SuqsResult,
  SuqsRow,
  UsageApp,
  UsageResult,
} from "./types";

/** Bucket decisions by their app id, preserving a stable label per app. */
function groupByApp(decisions: Decision[]): Map<string, { label: string; rows: Decision[] }> {
  const groups = new Map<string, { label: string; rows: Decision[] }>();
  for (const d of decisions) {
    const entry = groups.get(d.app) ?? { label: d.appLabel ?? d.app, rows: [] };
    // Keep the first non-empty label seen for the app.
    if (d.appLabel && entry.label === d.app) entry.label = d.appLabel;
    entry.rows.push(d);
    groups.set(d.app, entry);
  }
  return groups;
}

/**
 * Fold decisions into a tenant-wide total plus a per-app rollup, each app
 * carrying its own total and per-use-case breakdown. Pure. Empty in, empty out:
 * no decisions yields `{ totalCostUsd: 0, byApp: [] }`.
 */
export function aggregateUsage(decisions: Decision[]): UsageResult {
  let totalCostUsd = 0;
  for (const d of decisions) totalCostUsd += d.costUsd;

  const byApp: UsageApp[] = [...groupByApp(decisions).entries()]
    .map(([app, { label, rows }]) => {
      const byUseCase = new Map<string, number>();
      let appTotal = 0;
      for (const d of rows) {
        appTotal += d.costUsd;
        byUseCase.set(d.useCase, round6((byUseCase.get(d.useCase) ?? 0) + d.costUsd));
      }
      const useCases = [...byUseCase.entries()]
        .map(([useCase, costUsd]) => ({ useCase, costUsd }))
        .sort((a, b) => a.useCase.localeCompare(b.useCase));
      return { app, appLabel: label, totalCostUsd: round6(appTotal), useCases };
    })
    .sort((a, b) => a.app.localeCompare(b.app));

  return { totalCostUsd: round6(totalCostUsd), byApp };
}

/** Compute one SUQS row from a use case's decisions. */
function suqsRow(useCase: string, rows: Decision[], target: SloTarget | undefined): SuqsRow {
  const calls = rows.length;
  const totalCost = rows.reduce((sum, d) => sum + d.costUsd, 0);
  const blocked = rows.filter((d) => d.gateStatus === "block").length;
  return {
    useCase,
    calls,
    p95LatencyMs: percentile(rows.map((d) => d.latencyMs), 95),
    costPerAnswerUsd: round6(totalCost / calls),
    gateBlockRate: round6(blocked / calls),
    target: target ?? null,
  };
}

/**
 * Compute SUQS metrics grouped by app then use case from real decisions: p95
 * latency, cost per answer, and gate block rate. `targetFor` supplies the
 * profile SLO target for a use case, or undefined when none is configured (the
 * row's target is then null). Pure and empty-safe: no decisions yields
 * `{ byApp: [] }`.
 */
export function computeSuqs(
  decisions: Decision[],
  targetFor: (useCase: string) => SloTarget | undefined = () => undefined,
): SuqsResult {
  const byApp: SuqsApp[] = [...groupByApp(decisions).entries()]
    .map(([app, { label, rows }]) => {
      const byUseCase = new Map<string, Decision[]>();
      for (const d of rows) {
        const list = byUseCase.get(d.useCase) ?? [];
        list.push(d);
        byUseCase.set(d.useCase, list);
      }
      const useCases = [...byUseCase.entries()]
        .map(([useCase, ucRows]) => suqsRow(useCase, ucRows, targetFor(useCase)))
        .sort((a, b) => a.useCase.localeCompare(b.useCase));
      return { app, appLabel: label, useCases };
    })
    .sort((a, b) => a.app.localeCompare(b.app));

  return { byApp };
}

/** Nearest-rank percentile over a numeric sample. Returns 0 for an empty
 *  sample. `p` is a whole percentile in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[idx];
}

/** Keep money math from accumulating float noise across many decisions. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Filter decisions to those at or after `since` (epoch ms). */
export function withinWindow(decisions: Decision[], since: number): Decision[] {
  if (!Number.isFinite(since) || since <= 0) return decisions;
  return decisions.filter((d) => d.at >= since);
}

/**
 * Turn a `window` query value into an epoch-ms lower bound given `now`.
 * Accepts `<n>h`, `<n>d`, `<n>m` (minutes), or a bare number of hours. An empty
 * or unrecognized value means "all time" and yields 0 (no lower bound).
 */
export function parseWindow(window: string | null | undefined, now: number): number {
  if (!window) return 0;
  const m = /^(\d+)\s*([hdm]?)$/.exec(window.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unitMs = m[2] === "d" ? 86_400_000 : m[2] === "m" ? 60_000 : 3_600_000;
  return now - n * unitMs;
}

/**
 * Default decision store: a per-tenant array of decisions held in memory. A
 * durable backend implements the same `DecisionStore` interface; nothing else
 * in the gateway changes when it is swapped in.
 */
export class InMemoryDecisionStore implements DecisionStore {
  private readonly byTenant = new Map<string, Decision[]>();

  append(record: Decision): void {
    const rows = this.byTenant.get(record.tenant) ?? [];
    rows.push(record);
    this.byTenant.set(record.tenant, rows);
  }

  query(tenant: string, filter: DecisionQuery = {}): Decision[] {
    let rows = [...(this.byTenant.get(tenant) ?? [])];
    if (typeof filter.since === "number") rows = rows.filter((d) => d.at >= filter.since!);
    if (typeof filter.until === "number") rows = rows.filter((d) => d.at < filter.until!);
    if (filter.useCase) rows = rows.filter((d) => d.useCase === filter.useCase);
    return rows;
  }
}
