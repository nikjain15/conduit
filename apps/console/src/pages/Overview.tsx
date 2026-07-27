import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { SuqsResult, SuqsRow, UsageResult } from "@conduit/client";
import { NoLiveData } from "./NoLiveData.tsx";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** A SUQS row is over target when any measured value exceeds its target. */
function overTarget(row: SuqsRow): boolean {
  const t = row.target;
  if (!t) return false;
  return (
    (t.p95LatencyMs !== undefined && row.p95LatencyMs > t.p95LatencyMs) ||
    (t.costPerAnswerUsd !== undefined && row.costPerAnswerUsd > t.costPerAnswerUsd) ||
    (t.gateBlockRate !== undefined && row.gateBlockRate > t.gateBlockRate)
  );
}

export function Overview() {
  const [usage, setUsage] = useState<UsageResult | null>(null);
  const [suqs, setSuqs] = useState<SuqsResult | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([
      client.usage({ window: "month" }),
      client.suqs ? client.suqs({ window: "month" }) : Promise.resolve<SuqsResult>({ byApp: [] }),
    ]).then(([u, s]) => {
      if (!live) return;
      setUsage(u);
      setSuqs(s);
    });
    return () => {
      live = false;
    };
  }, []);

  const loading = usage === null || suqs === null;
  const hasUsage = !!usage && usage.byApp.length > 0;
  const hasSuqs = !!suqs && suqs.byApp.length > 0;

  // Flatten the grouped SUQS rows, keeping the app label on each so a flagged
  // row can be read as "app / useCase".
  const allRows = suqs
    ? suqs.byApp.flatMap((a) => a.useCases.map((r) => ({ appLabel: a.appLabel, row: r })))
    : [];
  const flagged = allRows.filter((x) => overTarget(x.row));

  return (
    <section className="page">
      <h2>Overview</h2>
      <p className="lead">
        Spend this month per app and a health summary from the SUQS service level objectives. Both read
        live from the gateway usage and suqs endpoints, grouped by the app each use case belongs to.
      </p>

      {loading ? (
        <p className="sub">Loading live data from the gateway.</p>
      ) : !hasUsage && !hasSuqs ? (
        <NoLiveData what="Monthly spend and SUQS health" />
      ) : (
        <div className="grid cols-2">
          <div className="card">
            <h3>Spend this month</h3>
            <p className="sub">Per app, reported by the gateway usage endpoint.</p>
            {hasUsage ? (
              <>
                <div className="stat" style={{ marginBottom: 18 }}>
                  <span className="value mono">{usd(usage!.totalCostUsd)}</span>
                  <span className="label">total across {usage!.byApp.length} apps</span>
                </div>
                {usage!.byApp.map((a) => (
                  <div className="app-rollup" key={a.app}>
                    <span className="app-rollup-name">{a.appLabel}</span>
                    <span className="mono">{usd(a.totalCostUsd)}</span>
                  </div>
                ))}
              </>
            ) : (
              <NoLiveData what="Spend" />
            )}
          </div>

          <div className="card">
            <h3>Health summary</h3>
            <p className="sub">Use cases measured against their SUQS targets.</p>
            {hasSuqs ? (
              <>
                <div className="stat" style={{ marginBottom: 18 }}>
                  <span className="value mono">
                    {allRows.length - flagged.length} / {allRows.length}
                  </span>
                  <span className="label">use cases within every target</span>
                </div>
                {flagged.length === 0 ? (
                  <p className="muted">All measured use cases are within target.</p>
                ) : (
                  <table className="data">
                    <tbody>
                      {flagged.map((x) => (
                        <tr key={`${x.appLabel}/${x.row.useCase}`}>
                          <td className="mono">
                            {x.appLabel} / {x.row.useCase}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            <span className="pill bad">over target</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <NoLiveData what="SUQS health" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
