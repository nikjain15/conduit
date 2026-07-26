import { useState } from "react";
import { Overview } from "./pages/Overview.tsx";
import { Models } from "./pages/Models.tsx";
import { EvalSetup } from "./pages/EvalSetup.tsx";
import { CostDashboards } from "./pages/CostDashboards.tsx";
import { Suqs } from "./pages/Suqs.tsx";
import { Prompts } from "./pages/Prompts.tsx";
import { Guardrails } from "./pages/Guardrails.tsx";
import { Agent } from "./pages/Agent.tsx";
import { usingMockGateway } from "./data/client.ts";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "models", label: "Models" },
  { id: "prompts", label: "Prompts" },
  { id: "guardrails", label: "Guardrails" },
  { id: "agent", label: "Agent" },
  { id: "evals", label: "Eval setup" },
  { id: "cost", label: "Cost dashboards" },
  { id: "suqs", label: "SUQS SLOs" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [tab, setTab] = useState<TabId>("overview");

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Conduit console</h1>
        <p>
          The control plane for the internal AI platform: routing, spend caps, evals, and service level
          objectives that products plug into.{" "}
          {usingMockGateway ? "Connected to the local mock gateway." : "Connected to a live gateway."}
        </p>
      </header>

      <nav className="tabs" role="tablist" aria-label="Console sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "overview" && <Overview />}
        {tab === "models" && <Models />}
        {tab === "prompts" && <Prompts />}
        {tab === "guardrails" && <Guardrails />}
        {tab === "agent" && <Agent />}
        {tab === "evals" && <EvalSetup />}
        {tab === "cost" && <CostDashboards />}
        {tab === "suqs" && <Suqs />}
      </main>
    </div>
  );
}
