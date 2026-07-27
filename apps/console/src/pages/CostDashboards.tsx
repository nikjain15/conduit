import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import type { UsageResult } from "@conduit/client";
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

  // Scale the per-use-case bars to the highest-spending use case across all apps.
  const maxUseCase = usage
    ? Math.max(...usage.byApp.flatMap((a) => a.useCases.map((u) => u.costUsd)), 1)
    : 1;

  return (
    <section className="page">
      <h2>Cost dashboards</h2>
      <p className="lead">
        Spend this month read live from the gateway usage endpoint: a per-app rollup first, then the
        per-use-case breakdown within each app. Bars are scaled to the highest-spending use case.
      </p>

      {usage === null ? (
        <p className="sub">Loading spend from the gateway.</p>
      ) : usage.byApp.length === 0 ? (
        <NoLiveData what="Per app spend" />
      ) : (
        <>
          <div className="card" style={{ marginBottom: 18 }}>
            <h3>Total spend this month</h3>
            <div className="stat" style={{ marginBottom: 12 }}>
              <span className="value mono">{usd(usage.totalCostUsd)}</span>
              <span className="label">across {usage.byApp.length} apps</span>
            </div>
            {usage.byApp.map((a) => (
              <div className="app-rollup" key={a.app}>
                <span className="app-rollup-name">{a.appLabel}</span>
                <span className="mono">{usd(a.totalCostUsd)}</span>
              </div>
            ))}
          </div>

          {usage.byApp.map((a) => (
            <div className="app-group" key={a.app}>
              <div className="app-heading">
                <h3>{a.appLabel}</h3>
                <span className="app-count mono">{usd(a.totalCostUsd)}</span>
              </div>
              <div className="grid cols-2">
                {a.useCases.map((u) => (
                  <div className="card" key={u.useCase}>
                    <span className="uc-tag">
                      <span className="uc-tag-app">{a.appLabel}</span>
                      <span className="uc-tag-sep">/</span>
                      <span>{u.useCase}</span>
                    </span>
                    <p className="sub">This month {usd(u.costUsd)}.</p>
                    <div className="bars" role="img" aria-label={`Spend for ${a.appLabel} ${u.useCase}`}>
                      <div className="bar-col">
                        <div className="bar-track">
                          <div className="bar" style={{ height: `${Math.round((u.costUsd / maxUseCase) * 100)}%` }} />
                        </div>
                        <span className="bar-label">this month</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
