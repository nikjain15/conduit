import { useEffect, useMemo, useState } from "react";
import type { UseCaseProfile } from "@conduit/client";
import { createSampleStore, resolvePrompt } from "@conduit/prompts";
import { client } from "../data/client.ts";
import { SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";

type Prompt = NonNullable<UseCaseProfile["prompt"]>;

/** The prompt registry backing the version list and live preview. Sample data. */
const PROMPT_STORE = createSampleStore();

/** Turn a record into ordered [key, value] rows for editing. */
function toRows(record: Record<string, string> | undefined): Array<[string, string]> {
  return Object.entries(record ?? {});
}

/** Rebuild a record from rows, dropping rows with a blank key. */
function fromRows(rows: Array<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of rows) if (k.trim() !== "") out[k] = v;
  return out;
}

/**
 * Prompts tab: an editor for the prompt sub section of each use case profile. It
 * edits the system prompt reference, the named templates, and the variables, then
 * persists through the gateway. The version list and the resolved preview read
 * the prompt registry so a version switch visibly changes the composed text.
 */
export function Prompts() {
  const { profiles, status } = useProfiles();
  const [draft, setDraft] = useState<UseCaseProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");
  const [previewVersion, setPreviewVersion] = useState<string>("");

  useEffect(() => {
    if (status === "ready" && profiles.length > 0) {
      setDraft(profiles.map((p) => ({ ...p, prompt: { ...(p.prompt ?? { systemRef: "" }) } })));
      setActiveId((prev) => prev || profiles[0].id);
    }
  }, [status, profiles]);

  const active = draft.find((p) => p.id === activeId);
  const prompt: Prompt = active?.prompt ?? { systemRef: "" };
  const record = PROMPT_STORE.prompts[prompt.systemRef];

  // Reset the preview version when the systemRef changes to a known record.
  useEffect(() => {
    setPreviewVersion(record ? record.active : "");
  }, [prompt.systemRef, record]);

  const resolved = useMemo(() => {
    if (!record) return null;
    return resolvePrompt(PROMPT_STORE, prompt.systemRef, prompt.variables ?? {}, {
      version: previewVersion || undefined,
      templates: prompt.templates,
    });
  }, [record, prompt.systemRef, prompt.variables, prompt.templates, previewVersion]);

  function patchPrompt(patch: Partial<Prompt>) {
    setDraft((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, prompt: { ...prompt, ...patch } } : p)),
    );
    setSaveState("");
  }

  async function save() {
    if (!active || !client.updateProfile) return;
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
        <h2>Prompts</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || !active) {
    return (
      <section className="page">
        <h2>Prompts</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const templateRows = toRows(prompt.templates);
  const variableRows = toRows(prompt.variables);

  return (
    <section className="page">
      <h2>Prompts</h2>
      <p className="lead">
        The system prompt reference, templates, and variables each use case assembles before a call.
        The resolver composes templates and fills variables to produce the system text.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="prompt-usecase">Use case</label>
        <select
          id="prompt-usecase"
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
        <h3>System prompt</h3>
        <div className="field">
          <label htmlFor="systemRef">System prompt reference</label>
          <input
            id="systemRef"
            type="text"
            aria-label="System prompt reference"
            value={prompt.systemRef}
            onChange={(e) => patchPrompt({ systemRef: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Versions</label>
          {!record ? (
            <span className="muted">No registered prompt for this reference.</span>
          ) : (
            record.versions.map((v) => (
              <div className="version-row" key={v.version}>
                <input
                  type="radio"
                  name="prompt-version"
                  aria-label={`Preview version ${v.version}`}
                  checked={(previewVersion || record.active) === v.version}
                  onChange={() => setPreviewVersion(v.version)}
                />
                <span className="mono">{v.version}</span>
                {v.version === record.active && <span className="version-active">active</span>}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <h3>Templates</h3>
        <p className="sub">Named snippets composed into the system text with a template include.</p>
        {templateRows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>None configured.</p>}
        {templateRows.map(([k, v], i) => (
          <div className="kv-row" key={i}>
            <input
              type="text"
              aria-label="Template name"
              placeholder="name"
              value={k}
              onChange={(e) => {
                const next = templateRows.map((r, j): [string, string] => (j === i ? [e.target.value, r[1]] : r));
                patchPrompt({ templates: fromRows(next) });
              }}
            />
            <input
              type="text"
              aria-label="Template snippet"
              placeholder="snippet"
              value={v}
              onChange={(e) => {
                const next = templateRows.map((r, j): [string, string] => (j === i ? [r[0], e.target.value] : r));
                patchPrompt({ templates: fromRows(next) });
              }}
            />
            <button
              type="button"
              className="link-action"
              onClick={() => patchPrompt({ templates: fromRows(templateRows.filter((_, j) => j !== i)) })}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="actions">
          <button
            type="button"
            className="link-action"
            onClick={() => patchPrompt({ templates: { ...fromRows(templateRows), "": "" } })}
          >
            Add template
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Variables</h3>
        <p className="sub">Values interpolated into the system text and templates.</p>
        {variableRows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>None configured.</p>}
        {variableRows.map(([k, v], i) => (
          <div className="kv-row" key={i}>
            <input
              type="text"
              aria-label="Variable name"
              placeholder="name"
              value={k}
              onChange={(e) => {
                const next = variableRows.map((r, j): [string, string] => (j === i ? [e.target.value, r[1]] : r));
                patchPrompt({ variables: fromRows(next) });
              }}
            />
            <input
              type="text"
              aria-label="Variable value"
              placeholder="value"
              value={v}
              onChange={(e) => {
                const next = variableRows.map((r, j): [string, string] => (j === i ? [r[0], e.target.value] : r));
                patchPrompt({ variables: fromRows(next) });
              }}
            />
            <button
              type="button"
              className="link-action"
              onClick={() => patchPrompt({ variables: fromRows(variableRows.filter((_, j) => j !== i)) })}
            >
              Remove
            </button>
          </div>
        ))}
        <div className="actions">
          <button
            type="button"
            className="link-action"
            onClick={() => patchPrompt({ variables: { ...fromRows(variableRows), "": "" } })}
          >
            Add variable
          </button>
        </div>
      </div>

      {resolved && (
        <div className="card">
          <h3>Resolved system prompt</h3>
          <p className="sub">Version {resolved.version}, composed and interpolated by the resolver.</p>
          <div className="code-preview">{resolved.text}</div>
          {resolved.warnings.length > 0 && (
            <ul className="warn-note">
              {resolved.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="actions">
        <button type="button" className="link-action" onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </section>
  );
}
