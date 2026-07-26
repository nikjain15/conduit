import { useEffect, useMemo, useState } from "react";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";

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

/**
 * Guardrails tab: an editor for the guardrails sub section of each use case
 * profile. It toggles PII handling (with a redact or block policy), the injection
 * guard, edits the output schema and the human in the loop threshold, and picks
 * the mandatory floors from the use case's own eval keys. Edits persist through
 * the gateway.
 */
export function Guardrails() {
  const { profiles, status } = useProfiles();
  const [draft, setDraft] = useState<UseCaseProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");
  const [schemaText, setSchemaText] = useState<string>("");
  const [schemaError, setSchemaError] = useState<string>("");

  useEffect(() => {
    if (status === "ready" && profiles.length > 0) {
      setDraft(profiles.map((p) => ({ ...p, guardrails: { ...(p.guardrails ?? {}) } })));
      setActiveId((prev) => prev || profiles[0].id);
    }
  }, [status, profiles]);

  const active = draft.find((p) => p.id === activeId);
  const g: Guardrails = active?.guardrails ?? {};

  // Keep the schema textarea in step with the active use case.
  useEffect(() => {
    setSchemaText(schemaToText(g.outputSchema));
    setSchemaError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // The floors a use case may pick are its own eval keys.
  const evalKeys = useMemo(
    () => (active?.evals ?? []).map((e) => e.key).filter((k) => k.trim() !== ""),
    [active],
  );

  function patchGuardrails(patch: Partial<Guardrails>) {
    setDraft((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, guardrails: { ...g, ...patch } } : p)),
    );
    setSaveState("");
  }

  function onSchemaChange(text: string) {
    setSchemaText(text);
    setSaveState("");
    if (text.trim() === "") {
      setSchemaError("");
      patchGuardrails({ outputSchema: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      setSchemaError("");
      patchGuardrails({ outputSchema: parsed });
    } catch {
      setSchemaError("Output schema is not valid JSON. It will not be saved until fixed.");
    }
  }

  function toggleFloor(key: string, on: boolean) {
    const current = new Set(g.floors ?? []);
    if (on) current.add(key);
    else current.delete(key);
    patchGuardrails({ floors: [...current] });
  }

  async function save() {
    if (!active || !client.updateProfile) return;
    if (schemaError) {
      setSaveState("Fix the output schema before saving.");
      return;
    }
    setSaveState("Saving.");
    try {
      await client.updateProfile(active);
      setSaveState("Saved. Edits round-trip through the gateway.");
    } catch {
      setSaveState("Save failed.");
    }
  }

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Guardrails</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || !active) {
    return (
      <section className="page">
        <h2>Guardrails</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  return (
    <section className="page">
      <h2>Guardrails</h2>
      <p className="lead">
        The safety and policy controls each use case enforces: PII handling, injection defence, a
        structured output schema, a human in the loop threshold, and the mandatory floors that always
        apply. The engine combines these fail-closed, so the most severe outcome wins.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="guardrails-usecase">Use case</label>
        <select
          id="guardrails-usecase"
          value={activeId}
          onChange={(e) => {
            setActiveId(e.target.value);
            setSaveState("");
          }}
        >
          {draft.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <h3>PII protection</h3>
        <div className="toggle-row">
          <input
            type="checkbox"
            aria-label="PII protection"
            checked={g.pii === true}
            onChange={(e) => patchGuardrails({ pii: e.target.checked })}
          />
          <span className="toggle-note">Scan answers for PII before they are served.</span>
        </div>
        {g.pii && (
          <div className="field" style={{ maxWidth: 260 }}>
            <label htmlFor="pii-action">On a PII hit</label>
            <select
              id="pii-action"
              aria-label="PII policy"
              value={g.piiAction ?? "redact"}
              onChange={(e) => patchGuardrails({ piiAction: e.target.value as Guardrails["piiAction"] })}
            >
              <option value="redact">Redact (mask the matches)</option>
              <option value="block">Block (refuse the answer)</option>
            </select>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Injection guard</h3>
        <div className="toggle-row">
          <input
            type="checkbox"
            aria-label="Injection guard"
            checked={g.injectionGuard === true}
            onChange={(e) => patchGuardrails({ injectionGuard: e.target.checked })}
          />
          <span className="toggle-note">
            Deterministic, heuristic screen for prompt-injection and jailbreak patterns in the input.
          </span>
        </div>
      </div>

      <div className="card">
        <h3>Output schema</h3>
        <p className="sub">When set, the answer must parse as JSON and validate against this schema.</p>
        <div className="field">
          <label htmlFor="output-schema">Schema (JSON)</label>
          <textarea
            id="output-schema"
            aria-label="Output schema"
            rows={8}
            value={schemaText}
            onChange={(e) => onSchemaChange(e.target.value)}
          />
          {schemaError && <span className="warn-note">{schemaError}</span>}
        </div>
      </div>

      <div className="card">
        <h3>Human in the loop</h3>
        <div className="field" style={{ maxWidth: 260 }}>
          <label htmlFor="hitl">Confidence threshold</label>
          <input
            id="hitl"
            type="number"
            step="0.05"
            min="0"
            max="1"
            aria-label="Human in the loop threshold"
            value={g.hitlThreshold ?? ""}
            onChange={(e) => {
              const raw = e.target.value.trim();
              patchGuardrails({ hitlThreshold: raw === "" ? undefined : Number(raw) });
            }}
          />
          <span className="toggle-note">A confidence below this escalates to a human review.</span>
        </div>
      </div>

      <div className="card">
        <h3>Floors</h3>
        <p className="sub">
          Mandatory eval keys for this use case. A floor that does not run fails closed and blocks.
        </p>
        {evalKeys.length === 0 ? (
          <p className="muted" style={{ fontSize: 13 }}>This use case has no eval keys to select as floors.</p>
        ) : (
          evalKeys.map((key) => (
            <div className="toggle-row" key={key}>
              <input
                type="checkbox"
                aria-label={`Floor ${key}`}
                checked={(g.floors ?? []).includes(key)}
                onChange={(e) => toggleFloor(key, e.target.checked)}
              />
              <span className="mono">{key}</span>
            </div>
          ))
        )}
      </div>

      <div className="actions">
        <button type="button" className="link-action" onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </section>
  );
}
