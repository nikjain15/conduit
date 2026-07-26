import { useMemo, useState } from "react";
import { client } from "../data/client.ts";
import {
  MODEL_CATALOG,
  MODEL_CONFIG,
  SAMPLE_NOTICE,
  USE_CASES,
  type ModelConfig,
  type UseCase,
} from "../data/sample.ts";

function ModelCard({ useCase, initial }: { useCase: UseCase; initial: ModelConfig }) {
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
    const [provider, model] = cfg.mainModel.split("/");
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

  return (
    <div className="card">
      <h3>{useCase.name}</h3>
      <p className="sub">{useCase.summary}</p>

      <div className="field">
        <label htmlFor={`${useCase.id}-main`}>Main model</label>
        <select
          id={`${useCase.id}-main`}
          value={cfg.mainModel}
          onChange={(e) => update("mainModel", e.target.value)}
        >
          {MODEL_CATALOG.map((m) => (
            <option key={m.ref} value={m.ref}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${useCase.id}-backup`}>Backup model, used on cap hit</label>
        <select
          id={`${useCase.id}-backup`}
          value={cfg.backupModel}
          onChange={(e) => update("backupModel", e.target.value)}
        >
          {MODEL_CATALOG.map((m) => (
            <option key={m.ref} value={m.ref}>{m.label}</option>
          ))}
        </select>
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

  return (
    <section className="page">
      <h2>Models</h2>
      <p className="lead">
        Per use case routing: a main model, a backup that takes over on a cap hit, a monthly spend cap,
        and cached answer reuse where policy allows it.
      </p>
      <span className="notice">{SAMPLE_NOTICE}</span>

      <div className="grid cols-2">
        {USE_CASES.map((u) => (
          <ModelCard key={u.id} useCase={u} initial={byId[u.id]} />
        ))}
      </div>
    </section>
  );
}
