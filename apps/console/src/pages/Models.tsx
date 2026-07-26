import { useEffect, useMemo, useState } from "react";
import { client } from "../data/client.ts";
import type { CatalogModel } from "@conduit/client";
import {
  MODEL_CONFIG,
  SAMPLE_NOTICE,
  USE_CASES,
  type ModelConfig,
  type UseCase,
} from "../data/sample.ts";

/** Provider grouping order and display labels for the dropdowns. */
const PROVIDER_ORDER = ["anthropic", "workers-ai", "openrouter"] as const;
const PROVIDER_LABEL: Record<string, string> = {
  anthropic: "Anthropic managed",
  "workers-ai": "Cloudflare Workers-AI",
  openrouter: "OpenRouter",
};

/** Split a provider-prefixed ref into { provider, model } for the infer call.
 *  The provider is the first segment; the model id is everything after it, so
 *  multi-segment ids like "meta-llama/llama-3.3-70b-instruct" survive intact. */
function splitRef(ref: string): { provider: string; model: string } {
  const slash = ref.indexOf("/");
  if (slash < 0) return { provider: ref, model: ref };
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

interface ModelPickerProps {
  id: string;
  value: string;
  models: CatalogModel[];
  recommended: string[];
  onChange: (ref: string) => void;
}

/** A model dropdown: recommended refs for this use case first, then every model
 *  grouped by provider. */
function ModelPicker({ id, value, models, recommended, onChange }: ModelPickerProps) {
  const labelFor = (ref: string) => models.find((m) => m.ref === ref)?.name ?? ref;

  const byProvider = useMemo(() => {
    const map: Record<string, CatalogModel[]> = {};
    for (const m of models) (map[m.provider] ??= []).push(m);
    return map;
  }, [models]);

  const orderedProviders = [
    ...PROVIDER_ORDER.filter((p) => byProvider[p]?.length),
    ...Object.keys(byProvider).filter((p) => !PROVIDER_ORDER.includes(p as (typeof PROVIDER_ORDER)[number])),
  ];

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {recommended.length > 0 && (
        <optgroup label="Recommended for this use case">
          {recommended.map((ref) => (
            <option key={`rec-${ref}`} value={ref}>{labelFor(ref)}</option>
          ))}
        </optgroup>
      )}
      {orderedProviders.map((p) => (
        <optgroup key={p} label={PROVIDER_LABEL[p] ?? p}>
          {byProvider[p].map((m) => (
            <option key={m.ref} value={m.ref}>{m.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

interface ModelCardProps {
  useCase: UseCase;
  initial: ModelConfig;
  models: CatalogModel[];
  recommended: string[];
}

function ModelCard({ useCase, initial, models, recommended }: ModelCardProps) {
  const [cfg, setCfg] = useState<ModelConfig>(initial);
  const [saved, setSaved] = useState<string>("");
  const [testResult, setTestResult] = useState<string>("");
  const [testing, setTesting] = useState(false);

  const cachingLocked = !useCase.cachingAllowed;

  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) {
    setCfg((c) => ({ ...c, [key]: value }));
    setSaved("");
  }

  function onSave() {
    setSaved("Saved to sample store.");
  }

  async function onTest() {
    setTesting(true);
    setTestResult("");
    const { provider, model } = splitRef(cfg.mainModel);
    try {
      const res = await client.infer({
        useCase: useCase.id,
        messages: [{ role: "user", content: "Health check ping." }],
        pinModel: { provider, model },
        maxTokens: 64,
      });
      setTestResult(
        `Main model ${res.provider}/${res.model} responded in ${res.latencyMs} ms.`,
      );
    } catch {
      setTestResult("Test call failed against the gateway.");
    } finally {
      setTesting(false);
    }
  }

  const recommendedNames = recommended
    .slice(0, 3)
    .map((ref) => models.find((m) => m.ref === ref)?.name ?? ref);

  return (
    <div className="card">
      <h3>{useCase.name}</h3>
      <p className="sub">{useCase.summary}</p>

      {recommendedNames.length > 0 && (
        <p className="sub">
          Recommended for this use case: {recommendedNames.join(", ")}.
        </p>
      )}

      <div className="field">
        <label htmlFor={`${useCase.id}-main`}>Main model</label>
        <ModelPicker
          id={`${useCase.id}-main`}
          value={cfg.mainModel}
          models={models}
          recommended={recommended}
          onChange={(ref) => update("mainModel", ref)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${useCase.id}-backup`}>Backup model, used on cap hit</label>
        <ModelPicker
          id={`${useCase.id}-backup`}
          value={cfg.backupModel}
          models={models}
          recommended={recommended}
          onChange={(ref) => update("backupModel", ref)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${useCase.id}-cap`}>Monthly cap in USD</label>
        <input
          id={`${useCase.id}-cap`}
          type="number"
          min={0}
          step={50}
          value={cfg.monthlyCapUsd}
          onChange={(e) => update("monthlyCapUsd", Number(e.target.value))}
        />
      </div>

      <div className="toggle-row">
        <input
          id={`${useCase.id}-cache`}
          type="checkbox"
          checked={cfg.reuseCachedAnswers && !cachingLocked}
          disabled={cachingLocked}
          onChange={(e) => update("reuseCachedAnswers", e.target.checked)}
        />
        <label htmlFor={`${useCase.id}-cache`} style={{ margin: 0 }}>
          Reuse cached answers
          <span className="toggle-note" style={{ display: "block" }}>
            {cachingLocked
              ? "Caching is disallowed for customer facing and financial use cases."
              : "Serve a stored answer when an equivalent prompt was seen before."}
          </span>
        </label>
      </div>

      <div className="actions">
        <button className="link-action" onClick={onSave}>Save</button>
        <button className="link-action" onClick={onTest} disabled={testing}>
          {testing ? "Testing" : "Test"}
        </button>
        <span className="action-result">{saved || testResult}</span>
      </div>
    </div>
  );
}

export function Models() {
  const byId = useMemo(() => {
    const map: Record<string, ModelConfig> = {};
    for (const c of MODEL_CONFIG) map[c.useCaseId] = c;
    return map;
  }, []);

  const [models, setModels] = useState<CatalogModel[]>([]);
  const [recommended, setRecommended] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!client.models) {
        setStatus("error");
        return;
      }
      try {
        // One call per use case: each returns the full catalog plus the refs
        // recommended for that use case. The catalog is identical across calls,
        // so the last response populates the shared model list.
        const rec: Record<string, string[]> = {};
        let catalog: CatalogModel[] = [];
        for (const u of USE_CASES) {
          const res = await client.models({ useCase: u.id });
          catalog = res.models;
          rec[u.id] = res.recommended ?? [];
        }
        if (cancelled) return;
        setModels(catalog);
        setRecommended(rec);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="page">
      <h2>Models</h2>
      <p className="lead">
        Per use case routing over the live catalog: a main model, a backup that takes over on a cap hit,
        a monthly spend cap, and cached answer reuse where policy allows it. The catalog is loaded from
        the gateway, so any model available on OpenRouter can be routed alongside the curated managed and
        edge tiers.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>
      {status === "loading" && <p className="sub">Loading the model catalog from the gateway.</p>}
      {status === "error" && <p className="sub">The model catalog could not be loaded from the gateway.</p>}

      <div className="grid cols-2">
        {USE_CASES.map((u) => (
          <ModelCard
            key={u.id}
            useCase={u}
            initial={byId[u.id]}
            models={models}
            recommended={recommended[u.id] ?? []}
          />
        ))}
      </div>
    </section>
  );
}
