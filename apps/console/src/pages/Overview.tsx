import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { UsageResult } from "@conduit/client";
import { SAMPLE_NOTICE, SLO_ROWS, USE_CASES, useCaseName } from "../data/sample.ts";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function Overview() {
  const [usage, setUsage] = useState<UsageResult | null>(null);

  useEffect(() => {
    let live = true;
    client.usage({ window: "month" }).then((u) => {
      if (live) setUsage(u);
    });
    return () => {
      live = false;
    };
  }, []);

  const overTarget = SLO_ROWS.filter(
    (r) =>
      r.p95LatencyMs > r.p95TargetMs ||
      r.costPerAnswerUsd > r.costTargetUsd ||
      r.gateBlockRate > r.gateBlockTarget,
  );

  return (
    <section className="page">
      <h2>Overview</h2>
      <p className="lead">
        Spend this month across use cases and a health summary from the SUQS service level objectives.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="grid cols-2">
        <div className="card">
          <h3>Spend this month</h3>
          <p className="sub">Reported by the gateway usage endpoint.</p>
          <div className="stat" style={{ marginBottom: 18 }}>
            <span className="value mono">{usage ? usd(usage.totalCostUsd) : "..."}</span>
            <span className="label">total across {USE_CASES.length} use cases</span>
          </div>
          <table className="data">
            <tbody>
              {usage
                ? Object.entries(usage.byUseCase).map(([id, v]) => (
                    <tr key={id}>
                      <td>{useCaseName(id)}</td>
                      <td className="mono" style={{ textAlign: "right" }}>{usd(v)}</td>
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Health summary</h3>
          <p className="sub">Use cases measured against their SUQS targets.</p>
          <div className="stat" style={{ marginBottom: 18 }}>
            <span className="value mono">
              {SLO_ROWS.length - overTarget.length} / {SLO_ROWS.length}
            </span>
            <span className="label">use cases within every target</span>
          </div>
          {overTarget.length === 0 ? (
            <p className="muted">All sample use cases are within target.</p>
          ) : (
            <table className="data">
              <tbody>
                {overTarget.map((r) => (
                  <tr key={r.useCaseId}>
                    <td>{useCaseName(r.useCaseId)}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="pill bad">over target</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  );
}
