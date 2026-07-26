import { useEffect, useState } from "react";
import { RETRIEVER_NAMES } from "@conduit/profile";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";

type Retrieval = NonNullable<UseCaseProfile["retrieval"]>;

/** Source options: the retriever registry names, plus any source a loaded
 *  profile already names that is not a registered retriever, so an existing
 *  config never renders with an empty selection. */
function sourceOptions(profiles: UseCaseProfile[]): string[] {
  const names = new Set<string>(RETRIEVER_NAMES);
  for (const p of profiles) if (p.retrieval?.source) names.add(p.retrieval.source);
  return [...names];
}

/** A default retrieval block when a use case turns retrieval on. */
function defaultRetrieval(): Retrieval {
  return {
    source: RETRIEVER_NAMES[0],
    chunking: { size: 800, overlap: 100 },
    embedModel: "",
    topK: 5,
    groundingThreshold: 0.5,
  };
}

/** Parse a numeric field: blank leaves the value undefined. */
function parseNum(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

export function Retrieval() {
  const { profiles, status } = useProfiles();
  const [draft, setDraft] = useState<UseCaseProfile[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [saveState, setSaveState] = useState<string>("");

  // Take a working copy once profiles load, so edits are local until saved.
  useEffect(() => {
    if (status === "ready" && profiles.length > 0) {
      setDraft(
        profiles.map((p) => ({
          ...p,
          retrieval: p.retrieval ? { ...p.retrieval, chunking: p.retrieval.chunking ? { ...p.retrieval.chunking } : undefined } : p.retrieval,
        })),
      );
      setActiveId((prev) => prev || profiles[0].id);
    }
  }, [status, profiles]);

  const sources = sourceOptions(profiles);
  const active = draft.find((p) => p.id === activeId);

  function editRetrieval(mutate: (r: Retrieval) => Retrieval | null) {
    setDraft((prev) =>
      prev.map((p) => {
        if (p.id !== activeId) return p;
        const current = p.retrieval ?? defaultRetrieval();
        return { ...p, retrieval: mutate(current) };
      }),
    );
    setSaveState("");
  }

  function setEnabled(enabled: boolean) {
    setDraft((prev) =>
      prev.map((p) =>
        p.id === activeId ? { ...p, retrieval: enabled ? p.retrieval ?? defaultRetrieval() : null } : p,
      ),
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
        <h2>Retrieval</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }

  if (status === "error" || !active) {
    return (
      <section className="page">
        <h2>Retrieval</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const retrieval = active.retrieval;
  const enabled = !!retrieval;

  return (
    <section className="page">
      <h2>Retrieval</h2>
      <p className="lead">
        Grounded retrieval per use case, driven by the retriever registry. Pick a retriever, size the
        chunks, and set the grounding threshold below which the answer is refused as not found rather
        than invented.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="retrieval-usecase">Use case</label>
        <select
          id="retrieval-usecase"
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
        <div className="field">
          <label htmlFor="retrieval-enabled">
            <input
              id="retrieval-enabled"
              type="checkbox"
              aria-label="Enable retrieval"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Ground this use case with retrieval
          </label>
        </div>

        {!enabled && (
          <p className="muted" style={{ fontSize: 13 }}>
            Retrieval is disabled for this use case. It answers from the model alone, with no grounding
            corpus. Enable retrieval to configure a retriever.
          </p>
        )}

        {enabled && retrieval && (
          <div className="grid cols-2">
            <div className="field">
              <label htmlFor="retrieval-source">Source</label>
              <select
                id="retrieval-source"
                aria-label="Retriever source"
                value={retrieval.source}
                onChange={(e) => editRetrieval((r) => ({ ...r, source: e.target.value }))}
              >
                {sources.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label htmlFor="retrieval-topk">Top K</label>
              <input
                id="retrieval-topk"
                type="number"
                aria-label="Top K"
                value={retrieval.topK ?? ""}
                onChange={(e) => editRetrieval((r) => ({ ...r, topK: parseNum(e.target.value) }))}
              />
            </div>

            <div className="field">
              <label htmlFor="retrieval-chunk-size">Chunk size</label>
              <input
                id="retrieval-chunk-size"
                type="number"
                aria-label="Chunk size"
                value={retrieval.chunking?.size ?? ""}
                onChange={(e) =>
                  editRetrieval((r) => ({
                    ...r,
                    chunking: { size: parseNum(e.target.value) ?? 0, overlap: r.chunking?.overlap ?? 0 },
                  }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="retrieval-chunk-overlap">Chunk overlap</label>
              <input
                id="retrieval-chunk-overlap"
                type="number"
                aria-label="Chunk overlap"
                value={retrieval.chunking?.overlap ?? ""}
                onChange={(e) =>
                  editRetrieval((r) => ({
                    ...r,
                    chunking: { size: r.chunking?.size ?? 0, overlap: parseNum(e.target.value) ?? 0 },
                  }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="retrieval-embed">Embed model</label>
              <input
                id="retrieval-embed"
                type="text"
                aria-label="Embed model"
                value={retrieval.embedModel ?? ""}
                onChange={(e) =>
                  editRetrieval((r) => ({ ...r, embedModel: e.target.value === "" ? undefined : e.target.value }))
                }
              />
            </div>

            <div className="field">
              <label htmlFor="retrieval-threshold">Grounding threshold</label>
              <input
                id="retrieval-threshold"
                type="number"
                step="0.01"
                aria-label="Grounding threshold"
                value={retrieval.groundingThreshold ?? ""}
                onChange={(e) =>
                  editRetrieval((r) => ({ ...r, groundingThreshold: parseNum(e.target.value) }))
                }
              />
            </div>
          </div>
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
