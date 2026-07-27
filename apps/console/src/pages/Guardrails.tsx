import { useState } from "react";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { appOfUseCase, SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";
import { AppHeading, groupByApp, UseCaseTag } from "./AppGroup.tsx";

type Guardrails = NonNullable<UseCaseProfile["guardrails"]>;

/** Pretty print an output schema for the textarea, or empty when unset. */
function schemaToText(schema: unknown): string {
  if (schema === undefined || schema === null) return "";
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return "";
  }
}

interface CardProps {
  profile: UseCaseProfile;
}

function GuardrailsCard({ profile }: CardProps) {
  const [draft, setDraft] = useState<UseCaseProfile>(profile);
  const [saveState, setSaveState] = useState<string>("");
  const [schemaText, setSchemaText] = useState<string>(schemaToText(profile.guardrails?.outputSchema));
  const [schemaError, setSchemaError] = useState<string>("");
  const app = appOfUseCase(profile.id);
  const g: Guardrails = draft.guardrails ?? {};
  const evalKeys = (draft.evals ?? []).map((e) => e.key).filter((k) => k.trim() !== "");

  function patch(patchG: Partial<Guardrails>) {
    setDraft((p) => ({ ...p, guardrails: { ...(p.guardrails ?? {}), ...patchG } }));
    setSaveState("");
  }

  function onSchemaChange(text: string) {
    setSchemaText(text);
    setSaveState("");
    if (text.trim() === "") {
      setSchemaError("");
      patch({ outputSchema: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setSchemaError("");
      patch({ outputSchema: parsed });
    } catch {
      setSchemaError("Output schema is not valid JSON. It will not be saved until fixed.");
    }
  }

  function toggleFloor(key: string, on: boolean) {
    const current = new Set(g.floors ?? []);
    if (on) current.add(key);
    else current.delete(key);
    patch({ floors: [...current] });
  }

  async function save() {
    if (!client.updateProfile) return;
    if (schemaError) {
      setSaveState("Fix the output schema before saving.");
      return;
    }
    setSaveState("Saving.");
    try {
      await client.updateProfile(draft);
      setSaveState("Saved. Edits round-trip through the gateway.");
    } catch {
      setSaveState("Save failed.");
    }
  }

  return (
    <div className="card">
      <UseCaseTag app={app} useCase={profile.name} />

      <div className="field">
        <div className="toggle-row">
          <input
            type="checkbox"
            aria-label={`PII protection ${profile.id}`}
            checked={g.pii === true}
            onChange={(e) => patch({ pii: e.target.checked })}
          />
          <span className="toggle-note">Scan answers for PII before they are served.</span>
        </div>
        {g.pii && (
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor={`pii-action-${profile.id}`}>On a PII hit</label>
            <select
              id={`pii-action-${profile.id}`}
              aria-label={`PII policy ${profile.id}`}
              value={g.piiAction ?? "redact"}
              onChange={(e) => patch({ piiAction: e.target.value as Guardrails["piiAction"] })}
            >
              <option value="redact">Redact (mask the matches)</option>
              <option value="block">Block (refuse the answer)</option>
            </select>
          </div>
        )}
      </div>

      <div className="toggle-row">
        <input
          type="checkbox"
          aria-label={`Injection guard ${profile.id}`}
          checked={g.injectionGuard === true}
          onChange={(e) => patch({ injectionGuard: e.target.checked })}
        />
        <span className="toggle-note">
          Deterministic, heuristic screen for prompt-injection and jailbreak patterns in the input.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`output-schema-${profile.id}`}>Output schema (JSON)</label>
        <textarea
          id={`output-schema-${profile.id}`}
          aria-label={`Output schema ${profile.id}`}
          rows={5}
          value={schemaText}
          onChange={(e) => onSchemaChange(e.target.value)}
        />
        {schemaError && <span className="warn-note">{schemaError}</span>}
      </div>

      <div className="field" style={{ maxWidth: 260 }}>
        <label htmlFor={`hitl-${profile.id}`}>Human in the loop confidence threshold</label>
        <input
          id={`hitl-${profile.id}`}
          type="number"
          step="0.05"
          min="0"
          max="1"
          aria-label={`Human in the loop threshold ${profile.id}`}
          value={g.hitlThreshold ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim();
            patch({ hitlThreshold: raw === "" ? undefined : Number(raw) });
          }}
        />
      </div>

      <div className="field">
        <label>Floors</label>
        <p className="sub">Mandatory eval keys. A floor that does not run fails closed and blocks.</p>
        {evalKeys.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>This use case has no eval keys to select as floors.</p>
        ) : (
          evalKeys.map((key) => (
            <div className="toggle-row" key={key}>
              <input
                type="checkbox"
                aria-label={`Floor ${key} ${profile.id}`}
                checked={(g.floors ?? []).includes(key)}
                onChange={(e) => toggleFloor(key, e.target.checked)}
              />
              <span className="mono">{key}</span>
            </div>
          ))
        )}
      </div>

      <div className="actions">
        <button type="button" className="link-action" aria-label={`Save ${profile.id}`} onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </div>
  );
}

export function Guardrails() {
  const { profiles, status } = useProfiles();

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Guardrails</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || profiles.length === 0) {
    return (
      <section className="page">
        <h2>Guardrails</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const groups = groupByApp(profiles, (p) => p.id);

  return (
    <section className="page">
      <h2>Guardrails</h2>
      <p className="lead">
        The safety and policy controls each use case enforces, grouped by app: PII handling, injection
        defence, a structured output schema, a human in the loop threshold, and the mandatory floors
        that always apply. The engine combines these fail-closed, so the most severe outcome wins.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      {groups.map((g) => (
        <div className="app-group" key={g.app}>
          <AppHeading label={g.label} count={g.items.length} />
          {g.items.map((p) => (
            <GuardrailsCard key={p.id} profile={p} />
          ))}
        </div>
      ))}
    </section>
  );
}
