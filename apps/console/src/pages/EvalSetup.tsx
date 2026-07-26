import { EVAL_SETUP, SAMPLE_NOTICE, useCaseName } from "../data/sample.ts";

export function EvalSetup() {
  return (
    <section className="page">
      <h2>Eval setup</h2>
      <p className="lead">
        The gates each use case must clear and the threshold that blocks a release or a live response.
        Inline gates run on every call, batch gates run against a labelled set.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="grid cols-2">
        {EVAL_SETUP.map((setup) => (
          <div className="card" key={setup.useCaseId}>
            <h3>{useCaseName(setup.useCaseId)}</h3>
            <p className="sub">{setup.gates.length} gates configured.</p>
            <table className="data">
              <thead>
                <tr>
                  <th>Gate</th>
                  <th>Threshold</th>
                  <th>Runs</th>
                </tr>
              </thead>
              <tbody>
                {setup.gates.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.label}
                      <div className="muted" style={{ fontSize: 12 }}>{g.metric}</div>
                    </td>
                    <td className="mono">{g.threshold}</td>
                    <td>
                      <span className="pill">{g.kind}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
