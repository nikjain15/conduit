import { SAMPLE_NOTICE } from "../data/sample.ts";
import { EDITOR_COMING, useProfiles } from "./useProfiles.ts";

/**
 * Prompts tab: a read only view of the prompt sub section of each use case
 * profile. The prompts workstream replaces this with a working editor.
 */
export function Prompts() {
  const { profiles, status } = useProfiles();

  return (
    <section className="page">
      <h2>Prompts</h2>
      <p className="lead">
        The system prompt reference, templates, and variables each use case assembles before a call.
        Values are read from the gateway profile for the use case.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>
      <p className="sub">{EDITOR_COMING}</p>

      {status === "loading" && <p className="sub">Loading profiles from the gateway.</p>}
      {status === "error" && <p className="sub">Profiles could not be loaded from the gateway.</p>}

      <div className="grid cols-2">
        {profiles.map((p) => {
          const templates = Object.entries(p.prompt?.templates ?? {});
          const variables = Object.entries(p.prompt?.variables ?? {});
          return (
            <div className="card" key={p.id}>
              <h3>{p.name}</h3>
              <div className="field">
                <label>System prompt reference</label>
                <span className="mono">{p.prompt?.systemRef || "not set"}</span>
              </div>
              <div className="field">
                <label>Templates</label>
                {templates.length === 0 ? (
                  <span className="muted">None configured.</span>
                ) : (
                  <ul className="mono">
                    {templates.map(([k]) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="field">
                <label>Variables</label>
                {variables.length === 0 ? (
                  <span className="muted">None configured.</span>
                ) : (
                  <ul className="mono">
                    {variables.map(([k, v]) => (
                      <li key={k}>{k}: {v}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
