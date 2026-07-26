import { SAMPLE_NOTICE, SLO_ROWS, useCaseName, type SloRow } from "../data/sample.ts";

function Meter({ value, target, invert }: { value: number; target: number; invert?: boolean }) {
  // invert false: lower is better, over target is bad.
  const ratio = Math.min(value / target, 1.4);
  const over = invert ? value < target : value > target;
  return (
    <div className="meter" aria-hidden="true">
      <span className={over ? "over" : ""} style={{ width: `${Math.min(ratio * 71, 100)}%` }} />
    </div>
  );
}

function flagged(r: SloRow): boolean {
  return (
    r.p95LatencyMs > r.p95TargetMs ||
    r.costPerAnswerUsd > r.costTargetUsd ||
    r.gateBlockRate > r.gateBlockTarget
  );
}

export function Suqs() {
  return (
    <section className="page">
      <h2>SUQS SLOs</h2>
      <p className="lead">
        Service level objectives for each use case: p95 latency, cost per answer, and gate block rate,
        each shown against its target. A row is flagged when any measure runs over target.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="data">
          <thead>
            <tr>
              <th>Use case</th>
              <th>p95 latency</th>
              <th>Cost per answer</th>
              <th>Gate block rate</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {SLO_ROWS.map((r) => (
              <tr key={r.useCaseId}>
                <td>{useCaseName(r.useCaseId)}</td>
                <td>
                  <span className="mono">{r.p95LatencyMs} ms</span>
                  <div className="muted" style={{ fontSize: 12 }}>target {r.p95TargetMs} ms</div>
                  <Meter value={r.p95LatencyMs} target={r.p95TargetMs} />
                </td>
                <td>
                  <span className="mono">${r.costPerAnswerUsd.toFixed(3)}</span>
                  <div className="muted" style={{ fontSize: 12 }}>target ${r.costTargetUsd.toFixed(3)}</div>
                  <Meter value={r.costPerAnswerUsd} target={r.costTargetUsd} />
                </td>
                <td>
                  <span className="mono">{(r.gateBlockRate * 100).toFixed(1)}%</span>
                  <div className="muted" style={{ fontSize: 12 }}>target {(r.gateBlockTarget * 100).toFixed(1)}%</div>
                  <Meter value={r.gateBlockRate} target={r.gateBlockTarget} />
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
      </div>
    </section>
  );
}
