import { useMemo, useState } from "react";
import { builtInMethodNames } from "@conduit/evals";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { appOfUseCase, SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";
import { AppHeading, groupByApp, UseCaseTag } from "./AppGroup.tsx";

type Spec = NonNullable<UseCaseProfile["evals"]>[number];
type When = Spec["when"];

/** Method names offered in the dropdown: the registry's built-ins, plus any
 *  method a loaded profile already names that is not a built-in. */
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

const GROUPS: Array<{ when: When; title: string; note: string }> = [
  { when: "inline", title: "Inline gates", note: "Run on every live call. A blocking failure stops the response." },
  { when: "batch", title: "Batch gates", note: "Run against a labelled set offline to measure quality." },
];

interface CardProps {
  profile: UseCaseProfile;
  methods: string[];
}

function EvalCard({ profile, methods }: CardProps) {
  const [draft, setDraft] = useState<UseCaseProfile>(profile);
  const [saveState, setSaveState] = useState<string>("");
  const app = appOfUseCase(profile.id);
  const specs = draft.evals ?? [];

  function mutateSpecs(mutate: (specs: Spec[]) => Spec[]) {
    setDraft((p) => ({ ...p, evals: mutate(p.evals ?? []) }));
    setSaveState("");
  }

  function editSpec(index: number, patch: Partial<Spec>) {
    mutateSpecs((s) => s.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)));
  }
  function removeSpec(index: number) {
    mutateSpecs((s) => s.filter((_, i) => i !== index));
  }
  function addSpec(when: When) {
    mutateSpecs((s) => [...s, newSpec(when, methods[0] ?? "regex")]);
  }

  async function save() {
    if (!client.updateProfile) return;
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
      {GROUPS.map((group) => {
        const rows = specs
          .map((spec, index) => ({ spec, index }))
          .filter(({ spec }) => spec.when === group.when);
        return (
          <div key={group.when} style={{ marginBottom: 10 }}>
            <h3 style={{ fontSize: 14 }}>{group.title}</h3>
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
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ spec, index }) => (
                    <tr key={index}>
                      <td>
                        <input
                          type="text"
                          aria-label={`Gate key ${profile.id}`}
                          value={spec.key}
                          onChange={(e) => editSpec(index, { key: e.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label={`Method ${profile.id}`}
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
                          aria-label={`Threshold ${profile.id}`}
                          value={spec.threshold === undefined ? "" : String(spec.threshold)}
                          onChange={(e) => editSpec(index, { threshold: parseThreshold(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Floor ${profile.id}`}
                          checked={spec.floor === true}
                          onChange={(e) => editSpec(index, { floor: e.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Mandatory ${profile.id}`}
                          checked={spec.mandatory === true}
                          onChange={(e) => editSpec(index, { mandatory: e.target.checked })}
                        />
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
              <button
                type="button"
                className="link-action"
                aria-label={`Add ${group.when} gate ${profile.id}`}
                onClick={() => addSpec(group.when)}
              >
                Add {group.when} gate
              </button>
            </div>
          </div>
        );
      })}
      <div className="actions">
        <button type="button" className="link-action" aria-label={`Save ${profile.id}`} onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </div>
  );
}

export function EvalSetup() {
  const { profiles, status } = useProfiles();
  const methods = useMemo(() => methodOptions(profiles), [profiles]);

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Eval setup</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || profiles.length === 0) {
    return (
      <section className="page">
        <h2>Eval setup</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const groups = groupByApp(profiles, (p) => p.id);

  return (
    <section className="page">
      <h2>Eval setup</h2>
      <p className="lead">
        The gates each use case must clear, grouped by app and driven by one declarative spec list. The
        same specs power the inline gate and the offline harness. Method resolves against the shared
        registry.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      {groups.map((g) => (
        <div className="app-group" key={g.app}>
          <AppHeading label={g.label} count={g.items.length} />
          {g.items.map((p) => (
            <EvalCard key={p.id} profile={p} methods={methods} />
          ))}
        </div>
      ))}
    </section>
  );
}
