import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { SuqsResult, SuqsRow } from "@conduit/client";
import { NoLiveData } from "./NoLiveData.tsx";

function Meter({ value, target }: { value: number; target?: number }) {
  // Lower is better: a bar over its target is bad. With no target, show a
  // neutral bar with no over/under judgement.
  if (target === undefined || target <= 0) {
    return (
      <div className="meter" aria-hidden="true">
        <span style={{ width: "50%" }} />
      </div>
    );
  }
  const ratio = Math.min(value / target, 1.4);
  const over = value > target;
  return (
    <div className="meter" aria-hidden="true">
      <span className={over ? "over" : ""} style={{ width: `${Math.min(ratio * 71, 100)}%` }} />
    </div>
  );
}

function flagged(r: SuqsRow): boolean {
  const t = r.target;
  if (!t) return false;
  return (
    (t.p95LatencyMs !== undefined && r.p95LatencyMs > t.p95LatencyMs) ||
    (t.costPerAnswerUsd !== undefined && r.costPerAnswerUsd > t.costPerAnswerUsd) ||
    (t.gateBlockRate !== undefined && r.gateBlockRate > t.gateBlockRate)
  );
}

function SuqsTable({ rows }: { rows: SuqsRow[] }) {
  return (
    <table className="data">
      <thead>
        <tr>
          <th>Use case</th>
          <th>Calls</th>
          <th>p95 latency</th>
          <th>Cost per answer</th>
          <th>Gate block rate</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.useCase}>
            <td className="mono">{r.useCase}</td>
            <td className="mono">{r.calls}</td>
            <td>
              <span className="mono">{r.p95LatencyMs} ms</span>
              {r.target?.p95LatencyMs !== undefined && (
                <div className="muted" style={{ fontSize: 12 }}>target {r.target.p95LatencyMs} ms</div>
              )}
              <Meter value={r.p95LatencyMs} target={r.target?.p95LatencyMs} />
            </td>
            <td>
              <span className="mono">${r.costPerAnswerUsd.toFixed(3)}</span>
              {r.target?.costPerAnswerUsd !== undefined && (
                <div className="muted" style={{ fontSize: 12 }}>target ${r.target.costPerAnswerUsd.toFixed(3)}</div>
              )}
              <Meter value={r.costPerAnswerUsd} target={r.target?.costPerAnswerUsd} />
            </td>
            <td>
              <span className="mono">{(r.gateBlockRate * 100).toFixed(1)}%</span>
              {r.target?.gateBlockRate !== undefined && (
                <div className="muted" style={{ fontSize: 12 }}>target {(r.target.gateBlockRate * 100).toFixed(1)}%</div>
              )}
              <Meter value={r.gateBlockRate} target={r.target?.gateBlockRate} />
            </td>
            <td>
              <span className={flagged(r) ? "pill bad" : "pill good"}>
                {flagged(r) ? "over target" : "within target"}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Suqs() {
  const [suqs, setSuqs] = useState<SuqsResult | null>(null);

  useEffect(() => {
    let live = true;
    const load = client.suqs
      ? client.suqs({ window: "month" })
      : Promise.resolve<SuqsResult>({ byApp: [] });
    void load.then((s) => {
      if (live) setSuqs(s);
    });
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="page">
      <h2>SUQS SLOs</h2>
      <p className="lead">
        Service level objectives per use case, grouped by app: p95 latency, cost per answer, and gate
        block rate, each shown against its target. Every measure is computed live from real metered
        decisions. A row is flagged when any measure runs over target.
      </p>

      {suqs === null ? (
        <p className="sub">Loading SUQS metrics from the gateway.</p>
      ) : suqs.byApp.length === 0 ? (
        <NoLiveData what="SUQS metrics" />
      ) : (
        suqs.byApp.map((a) => {
          const over = a.useCases.filter(flagged).length;
          return (
            <div className="app-group" key={a.app}>
              <div className="app-heading">
                <h3>{a.appLabel}</h3>
                <span className="app-count">
                  {a.useCases.length - over} / {a.useCases.length} within target
                </span>
              </div>
              <div className="card" style={{ overflowX: "auto" }}>
                <SuqsTable rows={a.useCases} />
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
