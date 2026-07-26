import { SAMPLE_NOTICE } from "../data/sample.ts";
import { EDITOR_COMING, useProfiles } from "./useProfiles.ts";

function yesNo(v: boolean | undefined): string {
  return v ? "on" : "off";
}

/**
 * Guardrails tab: a read only view of the guardrails sub section of each use
 * case profile. The guardrails workstream replaces this with a working editor.
 */
export function Guardrails() {
  const { profiles, status } = useProfiles();

  return (
    <section className="page">
      <h2>Guardrails</h2>
      <p className="lead">
        The safety and policy controls each use case enforces: PII handling, injection defence, a human
        in the loop threshold, and the non negotiable floors that always apply.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>
      <p className="sub">{EDITOR_COMING}</p>

      {status === "loading" && <p className="sub">Loading profiles from the gateway.</p>}
      {status === "error" && <p className="sub">Profiles could not be loaded from the gateway.</p>}

      <div className="grid cols-2">
        {profiles.map((p) => {
          const g = p.guardrails ?? {};
          const floors = g.floors ?? [];
          return (
            <div className="card" key={p.id}>
              <h3>{p.name}</h3>
              <div className="field">
                <label>PII protection</label>
                <span className="mono">{yesNo(g.pii)}</span>
              </div>
              <div className="field">
                <label>Injection guard</label>
                <span className="mono">{yesNo(g.injectionGuard)}</span>
              </div>
              <div className="field">
                <label>Human in the loop threshold</label>
                <span className="mono">{g.hitlThreshold ?? "not set"}</span>
              </div>
              <div className="field">
                <label>Floors</label>
                {floors.length === 0 ? (
                  <span className="muted">None configured.</span>
                ) : (
                  <div>
                    {floors.map((f) => (
                      <span className="pill" key={f}>{f}</span>
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
