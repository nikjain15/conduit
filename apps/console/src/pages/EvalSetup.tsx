import { useEffect, useMemo, useState } from "react";
import { builtInMethodNames } from "@conduit/evals";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";

type Spec = NonNullable<UseCaseProfile["evals"]>[number];
type When = Spec["when"];

/** Method names offered in the dropdown: the registry's built-ins, plus any
 *  method a loaded profile already names that is not a built-in, so an existing
 *  spec never renders with an empty selection. */
function methodOptions(profiles: UseCaseProfile[]): string[] {
  const names = new Set<string>(builtInMethodNames);
  for (const p of profiles) for (const e of p.evals ?? []) names.add(e.method);
  return [...names];
}

/** Parse a threshold field: blank clears it, a numeric string becomes a number,
 *  anything else is kept as an expression string the method understands. */
function parseThreshold(raw: string): Spec["threshold"] {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) && /^[-\d.]+$/.test(trimmed) ? n : trimmed;
}

function newSpec(when: When, method: string): Spec {
  return { key: "", method, when, floor: false, mandatory: false };
}

export function EvalSetup() {
  const { profiles, status } = useProfiles();
  const [draft, setDraft] = useState<UseCaseProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");

  // Take a working copy once the profiles load, so edits are local until saved.
  useEffect(() => {
    if (status === "ready" && profiles.length > 0) {
      setDraft(profiles.map((p) => ({ ...p, evals: (p.evals ?? []).map((e) => ({ ...e })) })));
      setActiveId((prev) => prev || profiles[0].id);
    }
  }, [status, profiles]);

  const methods = useMemo(() => methodOptions(profiles), [profiles]);
  const active = draft.find((p) => p.id === activeId);

  function updateActive(mutate: (specs: Spec[]) => Spec[]) {
    setDraft((prev) =>
      prev.map((p) => (p.id === activeId ? { ...p, evals: mutate(p.evals ?? []) } : p)),
    );
    setSaveState("");
  }

  function editSpec(index: number, patch: Partial<Spec>) {
    updateActive((specs) => specs.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSpec(index: number) {
    updateActive((specs) => specs.filter((_, i) => i !== index));
  }

  function addSpec(when: When) {
    updateActive((specs) => [...specs, newSpec(when, methods[0] ?? "regex")]);
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
        <h2>Eval setup</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }

  if (status === "error" || !active) {
    return (
      <section className="page">
        <h2>Eval setup</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const specs = active.evals ?? [];
  const groups: Array<{ when: When; title: string; note: string }> = [
    { when: "inline", title: "Inline gates", note: "Run on every live call. A blocking failure stops the response." },
    { when: "batch", title: "Batch gates", note: "Run against a labelled set offline to measure quality." },
  ];

  return (
    <section className="page">
      <h2>Eval setup</h2>
      <p className="lead">
        The gates each use case must clear, driven by one declarative spec list. The same specs power
        the inline gate and the offline harness. Method resolves against the shared registry.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="eval-usecase">Use case</label>
        <select
          id="eval-usecase"
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

      {groups.map((group) => {
        const rows = specs
          .map((spec, index) => ({ spec, index }))
          .filter(({ spec }) => spec.when === group.when);
        return (
          <div className="card" key={group.when}>
            <h3>{group.title}</h3>
            <p className="sub">{group.note}</p>
            {rows.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>No {group.when} gates yet.</p>
            ) : (
              <table className="data">
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Method</th>
                    <th>Threshold</th>
                    <th>Floor</th>
                    <th>Mandatory</th>
                    <th>When</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ spec, index }) => (
                    <tr key={index}>
                      <td>
                        <input
                          type="text"
                          aria-label="Gate key"
                          value={spec.key}
                          onChange={(e) => editSpec(index, { key: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Method"
                          value={spec.method}
                          onChange={(e) => editSpec(index, { method: e.target.value })}
                        >
                          {methods.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          aria-label="Threshold"
                          value={spec.threshold === undefined ? "" : String(spec.threshold)}
                          onChange={(e) => editSpec(index, { threshold: parseThreshold(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Floor"
                          checked={spec.floor === true}
                          onChange={(e) => editSpec(index, { floor: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label="Mandatory"
                          checked={spec.mandatory === true}
                          onChange={(e) => editSpec(index, { mandatory: e.target.checked })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="When"
                          value={spec.when}
                          onChange={(e) => editSpec(index, { when: e.target.value as When })}
                        >
                          <option value="inline">inline</option>
                          <option value="batch">batch</option>
                        </select>
                      </td>
                      <td>
                        <button type="button" className="link-action" onClick={() => removeSpec(index)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="actions">
              <button type="button" className="link-action" onClick={() => addSpec(group.when)}>
                Add {group.when} gate
              </button>
            </div>
          </div>
        );
      })}

      <div className="actions">
        <button type="button" className="link-action" onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </section>
  );
}
