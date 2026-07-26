import { COST_MONTHS, COST_TREND, SAMPLE_NOTICE, useCaseName } from "../data/sample.ts";

function usd(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function TrendCard({ useCaseId, series }: { useCaseId: string; series: number[] }) {
  const max = Math.max(...series, 1);
  const latest = series[series.length - 1] ?? 0;
  return (
    <div className="card">
      <h3>{useCaseName(useCaseId)}</h3>
      <p className="sub">Latest month {usd(latest)}.</p>
      <div className="bars" role="img" aria-label={`Monthly spend trend for ${useCaseName(useCaseId)}`}>
        {series.map((v, i) => (
          <div className="bar-col" key={COST_MONTHS[i]}>
            <div className="bar-track">
              <div className="bar" style={{ height: `${Math.round((v / max) * 100)}%` }} />
            </div>
            <span className="bar-label">{COST_MONTHS[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CostDashboards() {
  return (
    <section className="page">
      <h2>Cost dashboards</h2>
      <p className="lead">
        Spend per use case over the last {COST_MONTHS.length} months. Bars are drawn from the sample
        trend series, scaled to each use case peak.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="grid cols-2">
        {Object.entries(COST_TREND).map(([id, series]) => (
          <TrendCard key={id} useCaseId={id} series={series} />
        ))}
      </div>
    </section>
  );
}
