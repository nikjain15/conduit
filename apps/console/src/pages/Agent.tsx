import { SAMPLE_NOTICE } from "../data/sample.ts";
import { EDITOR_COMING, useProfiles } from "./useProfiles.ts";

/**
 * Agent tab: a read only view of the agent sub section of each use case
 * profile. The agent workstream replaces this with a working editor.
 */
export function Agent() {
  const { profiles, status } = useProfiles();

  const withAgent = profiles.filter((p) => p.agent);

  return (
    <section className="page">
      <h2>Agent</h2>
      <p className="lead">
        The agent loop each use case runs: single shot or a tool use loop, the tools and skills it may
        call, and the step budget. Use cases with no agent block run inference directly.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>
      <p className="sub">{EDITOR_COMING}</p>

      {status === "loading" && <p className="sub">Loading profiles from the gateway.</p>}
      {status === "error" && <p className="sub">Profiles could not be loaded from the gateway.</p>}
      {status === "ready" && withAgent.length === 0 && (
        <p className="sub">No use case has an agent block configured.</p>
      )}

      <div className="grid cols-2">
        {withAgent.map((p) => {
          const a = p.agent!;
          return (
            <div className="card" key={p.id}>
              <h3>{p.name}</h3>
              <div className="field">
                <label>Mode</label>
                <span className="mono">{a.mode}</span>
              </div>
              <div className="field">
                <label>Max steps</label>
                <span className="mono">{a.maxSteps ?? "not set"}</span>
              </div>
              <div className="field">
                <label>Tools</label>
                {a.tools.length === 0 ? (
                  <span className="muted">None configured.</span>
                ) : (
                  <div>
                    {a.tools.map((t) => (
                      <span className="pill" key={t}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="field">
                <label>Skills</label>
                {a.skills.length === 0 ? (
                  <span className="muted">None configured.</span>
                ) : (
                  <div>
                    {a.skills.map((s) => (
                      <span className="pill" key={s}>{s}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
