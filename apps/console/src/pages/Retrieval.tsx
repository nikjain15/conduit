import { useState } from "react";
import { RETRIEVER_NAMES } from "@conduit/profile";
import type { UseCaseProfile } from "@conduit/client";
import { client } from "../data/client.ts";
import { appOfUseCase, SAMPLE_NOTICE } from "../data/sample.ts";
import { useProfiles } from "./useProfiles.ts";
import { AppHeading, groupByApp, UseCaseTag } from "./AppGroup.tsx";

type Retrieval = NonNullable<UseCaseProfile["retrieval"]>;

/** Source options: the retriever registry names, plus any source a loaded
 *  profile already names that is not a registered retriever. */
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

interface CardProps {
  profile: UseCaseProfile;
  sources: string[];
}

/** One use case's retrieval editor. Self-contained: owns its draft and save. */
function RetrievalCard({ profile, sources }: CardProps) {
  const [draft, setDraft] = useState<UseCaseProfile>(profile);
  const [saveState, setSaveState] = useState<string>("");
  const app = appOfUseCase(profile.id);

  const retrieval = draft.retrieval;
  const enabled = !!retrieval;

  function editRetrieval(mutate: (r: Retrieval) => Retrieval) {
    setDraft((p) => ({ ...p, retrieval: mutate(p.retrieval ?? defaultRetrieval()) }));
    setSaveState("");
  }

  function setEnabled(on: boolean) {
    setDraft((p) => ({ ...p, retrieval: on ? p.retrieval ?? defaultRetrieval() : null }));
    setSaveState("");
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
      <div className="field">
        <label htmlFor={`retrieval-enabled-${profile.id}`}>
          <input
            id={`retrieval-enabled-${profile.id}`}
            type="checkbox"
            aria-label={`Enable retrieval ${profile.id}`}
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
            <label htmlFor={`retrieval-source-${profile.id}`}>Source</label>
            <select
              id={`retrieval-source-${profile.id}`}
              aria-label={`Retriever source ${profile.id}`}
              value={retrieval.source}
              onChange={(e) => editRetrieval((r) => ({ ...r, source: e.target.value }))}
            >
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor={`retrieval-topk-${profile.id}`}>Top K</label>
            <input
              id={`retrieval-topk-${profile.id}`}
              type="number"
              aria-label={`Top K ${profile.id}`}
              value={retrieval.topK ?? ""}
              onChange={(e) => editRetrieval((r) => ({ ...r, topK: parseNum(e.target.value) }))}
            />
          </div>

          <div className="field">
            <label htmlFor={`retrieval-chunk-size-${profile.id}`}>Chunk size</label>
            <input
              id={`retrieval-chunk-size-${profile.id}`}
              type="number"
              aria-label={`Chunk size ${profile.id}`}
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
            <label htmlFor={`retrieval-chunk-overlap-${profile.id}`}>Chunk overlap</label>
            <input
              id={`retrieval-chunk-overlap-${profile.id}`}
              type="number"
              aria-label={`Chunk overlap ${profile.id}`}
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
            <label htmlFor={`retrieval-embed-${profile.id}`}>Embed model</label>
            <input
              id={`retrieval-embed-${profile.id}`}
              type="text"
              aria-label={`Embed model ${profile.id}`}
              value={retrieval.embedModel ?? ""}
              onChange={(e) =>
                editRetrieval((r) => ({ ...r, embedModel: e.target.value === "" ? undefined : e.target.value }))
              }
            />
          </div>

          <div className="field">
            <label htmlFor={`retrieval-threshold-${profile.id}`}>Grounding threshold</label>
            <input
              id={`retrieval-threshold-${profile.id}`}
              type="number"
              step="0.01"
              aria-label={`Grounding threshold ${profile.id}`}
              value={retrieval.groundingThreshold ?? ""}
              onChange={(e) => editRetrieval((r) => ({ ...r, groundingThreshold: parseNum(e.target.value) }))}
            />
          </div>
        </div>
      )}

      <div className="actions">
        <button type="button" className="link-action" aria-label={`Save ${profile.id}`} onClick={() => void save()}>
          Save changes
        </button>
        {saveState && <span className="action-result">{saveState}</span>}
      </div>
    </div>
  );
}

export function Retrieval() {
  const { profiles, status } = useProfiles();

  if (status === "loading") {
    return (
      <section className="page">
        <h2>Retrieval</h2>
        <p className="lead">Loading use case profiles.</p>
      </section>
    );
  }
  if (status === "error" || profiles.length === 0) {
    return (
      <section className="page">
        <h2>Retrieval</h2>
        <p className="lead">Could not load use case profiles.</p>
      </section>
    );
  }

  const sources = sourceOptions(profiles);
  const groups = groupByApp(profiles, (p) => p.id);

  return (
    <section className="page">
      <h2>Retrieval</h2>
      <p className="lead">
        Grounded retrieval per use case, grouped by app and driven by the retriever registry. Pick a
        retriever, size the chunks, and set the grounding threshold below which the answer is refused as
        not found rather than invented.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      {groups.map((g) => (
        <div className="app-group" key={g.app}>
          <AppHeading label={g.label} count={g.items.length} />
          {g.items.map((p) => (
            <RetrievalCard key={p.id} profile={p} sources={sources} />
          ))}
        </div>
      ))}
    </section>
  );
}
