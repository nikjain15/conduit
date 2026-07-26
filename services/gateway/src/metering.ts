/**
 * Metering: the default in-memory sink plus the pure per-tenant aggregation.
 *
 * `aggregateUsage` is a pure function over a list of decisions, so /v1/usage is
 * testable without any store. `MemoryMeterSink` is the batteries-included sink
 * used when a caller does not inject a durable one; it keeps decisions bucketed
 * by tenant so a read for one tenant never sees another tenant's rows.
 */
import type { Decision, MeterSink, UsageByUseCase, UsageResult } from "./types";

/** Fold decisions into a total and a per-use-case rollup. Pure. */
export function aggregateUsage(decisions: Decision[]): UsageResult {
  const byUseCase = new Map<string, UsageByUseCase>();
  let totalCostUsd = 0;

  for (const d of decisions) {
    totalCostUsd += d.costUsd;
    const row = byUseCase.get(d.useCase) ?? { useCase: d.useCase, calls: 0, costUsd: 0 };
    row.calls += 1;
    row.costUsd += d.costUsd;
    byUseCase.set(d.useCase, row);
  }

  return {
    totalCostUsd: round6(totalCostUsd),
    byUseCase: [...byUseCase.values()]
      .map((r) => ({ ...r, costUsd: round6(r.costUsd) }))
      .sort((a, b) => a.useCase.localeCompare(b.useCase)),
  };
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

/** Default sink: a per-tenant array of decisions held in memory. */
export class MemoryMeterSink implements MeterSink {
  private readonly byTenant = new Map<string, Decision[]>();

  record(decision: Decision): void {
    const rows = this.byTenant.get(decision.tenant) ?? [];
    rows.push(decision);
    this.byTenant.set(decision.tenant, rows);
  }

  list(tenant: string): Decision[] {
    return [...(this.byTenant.get(tenant) ?? [])];
  }
}
