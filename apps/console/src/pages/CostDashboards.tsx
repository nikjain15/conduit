import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { UsageResult } from "@conduit/client";
import { useCaseName } from "../data/sample.ts";
import { NoLiveData } from "./NoLiveData.tsx";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function CostDashboards() {
  const [usage, setUsage] = useState<UsageResult | null>(null);

  useEffect(() => {
    let live = true;
    void client.usage({ window: "month" }).then((u) => {
      if (live) setUsage(u);
    });
    return () => {
      live = false;
    };
  }, []);

  const rows = usage ? Object.entries(usage.byUseCase) : [];
  const max = Math.max(...rows.map(([, v]) => v), 1);

  return (
    <section className="page">
      <h2>Cost dashboards</h2>
      <p className="lead">
        Spend per use case this month, read live from the gateway usage endpoint. Bars are scaled to the
        highest-spending use case.
      </p>

      {usage === null ? (
        <p className="sub">Loading spend from the gateway.</p>
      ) : rows.length === 0 ? (
        <NoLiveData what="Per use case spend" />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Total spend this month</h3>
            <div className="stat">
              <span className="value mono">{usd(usage.totalCostUsd)}</span>
              <span className="label">across {rows.length} use cases</span>
            </div>
          </div>
          <div className="grid cols-2">
            {rows.map(([id, v]) => (
              <div className="card" key={id}>
                <h3>{useCaseName(id)}</h3>
                <p className="sub">This month {usd(v)}.</p>
                <div className="bars" role="img" aria-label={`Spend for ${useCaseName(id)}`}>
                  <div className="bar-col">
                    <div className="bar-track">
                      <div className="bar" style={{ height: `${Math.round((v / max) * 100)}%` }} />
                    </div>
                    <span className="bar-label">this month</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
