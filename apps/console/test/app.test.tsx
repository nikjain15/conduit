// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { builtInMethodNames } from "@conduit/evals";
import { App } from "../src/App.tsx";
import { mockGatewayFetch, resetMockDecisions } from "../src/data/mockGateway.ts";
import { APPS, MODEL_CONFIG, USE_CASES } from "../src/data/sample.ts";

afterEach(() => {
  cleanup();
  resetMockDecisions();
});

describe("console shell", () => {
  it("renders the masthead and every section tab", () => {
    render(<App />);
    expect(screen.getByText("Conduit console")).toBeTruthy();
    for (const label of ["Overview", "Models", "Prompts", "Guardrails", "Agent", "Eval setup", "Retrieval", "Cost dashboards", "SUQS SLOs"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });
});

describe("Models tab grouped by app", () => {
  it("shows an app heading for every app and a card per use case", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));
    // Every app heading renders.
    for (const app of APPS) {
      expect(screen.getByRole("heading", { name: app.label })).toBeTruthy();
    }
    // One "Main model" field per use case across all apps.
    expect(screen.getAllByText("Main model").length).toBe(USE_CASES.length);
    // A card carries the real use case name.
    expect(screen.getByText("penny_categorize")).toBeTruthy();
  });
});

describe("Eval setup editor", () => {
  it("renders a registry-backed method dropdown per use case card", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Eval setup" }));
    await waitFor(() => expect(screen.getAllByLabelText("Method penny_categorize").length).toBeGreaterThan(0));

    const methodSelect = screen.getAllByLabelText("Method penny_categorize")[0] as HTMLSelectElement;
    const optionValues = new Set(
      within(methodSelect).getAllByRole("option").map((o) => (o as HTMLOptionElement).value),
    );
    for (const name of builtInMethodNames) expect(optionValues.has(name)).toBe(true);
  });

  it("adds a spec to a use case when its add button is clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Eval setup" }));
    await waitFor(() => expect(screen.getByLabelText("Add inline gate penny_categorize")).toBeTruthy());

    const before = screen.getAllByLabelText("Gate key penny_categorize").length;
    fireEvent.click(screen.getByLabelText("Add inline gate penny_categorize"));
    const after = screen.getAllByLabelText("Gate key penny_categorize").length;
    expect(after).toBe(before + 1);
  });
});

describe("Prompts editor", () => {
  it("renders each use case systemRef and a resolved preview", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Prompts" }));
    await waitFor(() => expect(screen.getByLabelText("System prompt reference penny_categorize")).toBeTruthy());

    const ref = screen.getByLabelText("System prompt reference penny_categorize") as HTMLInputElement;
    expect(ref.value).toBe("penny_categorize.system");
    expect(screen.getAllByText("Resolved system prompt").length).toBeGreaterThan(0);
  });

  it("round-trips an edited systemRef through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Prompts" }));
    await waitFor(() => expect(screen.getByLabelText("System prompt reference penny_categorize")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("System prompt reference penny_categorize"), {
      target: { value: "ask.system" },
    });
    fireEvent.click(screen.getByLabelText("Save penny_categorize"));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=penny_categorize", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ prompt: { systemRef: string } }> };
    expect(body.profiles[0].prompt.systemRef).toBe("ask.system");
  });
});

describe("Guardrails editor", () => {
  it("renders a use case's guardrails values and its eval keys as floors", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await waitFor(() => expect(screen.getByLabelText("Injection guard penny_categorize")).toBeTruthy());

    expect((screen.getByLabelText("PII protection penny_categorize") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Injection guard penny_categorize") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText("Floor pii-block penny_categorize")).toBeTruthy();
  });

  it("round-trips a toggled injection guard through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await waitFor(() => expect(screen.getByLabelText("Injection guard penny_categorize")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Injection guard penny_categorize")); // turn it off
    fireEvent.click(screen.getByLabelText("Save penny_categorize"));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=penny_categorize", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ guardrails: { injectionGuard?: boolean } }> };
    expect(body.profiles[0].guardrails.injectionGuard).toBe(false);
  });
});

describe("Retrieval editor", () => {
  it("notes when a use case has retrieval disabled and shows config when enabled", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Enable retrieval penny_categorize")).toBeTruthy());

    // penny_categorize has no retrieval block; penny_insights does (topK 5).
    expect((screen.getByLabelText("Enable retrieval penny_categorize") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText("Enable retrieval penny_insights") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Top K penny_insights") as HTMLInputElement).value).toBe("5");
  });

  it("round-trips an edited topK through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Top K penny_insights")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Top K penny_insights"), { target: { value: "9" } });
    fireEvent.click(screen.getByLabelText("Save penny_insights"));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=penny_insights", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ retrieval: { topK: number } }> };
    expect(body.profiles[0].retrieval.topK).toBe(9);
  });
});

describe("Agent editor", () => {
  it("renders a use case agent config with its tools", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await waitFor(() => expect(screen.getByLabelText("Enable agent penny_categorize")).toBeTruthy());

    expect((screen.getByLabelText("Enable agent penny_categorize") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Mode penny_categorize") as HTMLSelectElement).value).toBe("single");
    expect((screen.getByLabelText("Tool classify-intent penny_categorize") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Tool read-diff penny_categorize") as HTMLInputElement).checked).toBe(false);
  });

  it("round-trips a toggled tool through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await waitFor(() => expect(screen.getByLabelText("Enable agent penny_categorize")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Tool read-diff penny_categorize"));
    fireEvent.click(screen.getByLabelText("Save penny_categorize"));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=penny_categorize", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ agent: { tools: string[] } }> };
    expect(body.profiles[0].agent.tools).toContain("read-diff");
    expect(body.profiles[0].agent.tools).toContain("classify-intent");
  });
});

describe("honest empty states", () => {
  it("Overview renders the no live data panel when the store is empty", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("No live data yet")).toBeTruthy());
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("SUQS renders the no live data panel when the store is empty", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "SUQS SLOs" }));
    await waitFor(() => expect(screen.getByText("No live data yet")).toBeTruthy());
  });

  it("Cost dashboards renders the no live data panel when the store is empty", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Cost dashboards" }));
    await waitFor(() => expect(screen.getByText("No live data yet")).toBeTruthy());
  });
});

describe("Models live catalog", () => {
  it("lists a live-shaped catalog with recommendations for every use case", async () => {
    for (const u of USE_CASES) {
      const res = await mockGatewayFetch(`https://gateway.local/v1/models?useCase=${u.id}`, { method: "GET" });
      const body = (await res.json()) as {
        models: Array<{ ref: string; provider: string; promptPerMTok: number; contextLength: number }>;
        recommended: string[];
      };
      expect(body.models.length).toBeGreaterThan(0);
      const providers = new Set(body.models.map((m) => m.provider));
      expect(providers.has("openrouter")).toBe(true);
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("workers-ai")).toBe(true);
      expect(Array.isArray(body.recommended)).toBe(true);
      expect(body.recommended.length).toBeGreaterThan(0);
      const refs = new Set(body.models.map((m) => m.ref));
      for (const ref of body.recommended) expect(refs.has(ref)).toBe(true);
    }
  });
});

describe("caching policy", () => {
  it("locks caching off for financial use cases", () => {
    const insights = MODEL_CONFIG.find((c) => c.useCaseId === "penny_insights");
    const uc = USE_CASES.find((u) => u.id === "penny_insights");
    expect(uc?.cachingAllowed).toBe(false);
    expect(insights?.reuseCachedAnswers).toBe(false);
  });
});

describe("mock gateway app grouping", () => {
  it("starts with an empty usage and suqs state, never invented numbers", async () => {
    const usageRes = await mockGatewayFetch("https://gateway.local/v1/usage", { method: "GET" });
    const usage = (await usageRes.json()) as { totalCostUsd: number; byApp: unknown[] };
    expect(usage).toEqual({ totalCostUsd: 0, byApp: [] });

    const suqsRes = await mockGatewayFetch("https://gateway.local/v1/suqs", { method: "GET" });
    const suqs = (await suqsRes.json()) as { byApp: unknown[] };
    expect(suqs.byApp).toEqual([]);
  });

  it("groups a reported decision under its app, deriving the app from the use case", async () => {
    // The body claims a bogus app; the mock ignores it and derives founderfirst
    // from the penny_categorize use case, mirroring the token-derived app.
    await mockGatewayFetch("https://gateway.local/v1/decisions", {
      method: "POST",
      body: JSON.stringify({
        useCase: "penny_categorize",
        app: "rally",
        model: "claude-haiku-4-5",
        provider: "anthropic",
        costUsd: 0.002,
        latencyMs: 900,
        gateStatus: "pass",
        at: 1_000_000,
      }),
    });

    const usage = (await (await mockGatewayFetch("https://gateway.local/v1/usage", { method: "GET" })).json()) as {
      totalCostUsd: number;
      byApp: Array<{ app: string; appLabel: string; totalCostUsd: number; useCases: Array<{ useCase: string; costUsd: number }> }>;
    };
    expect(usage.byApp).toHaveLength(1);
    expect(usage.byApp[0].app).toBe("founderfirst");
    expect(usage.byApp[0].appLabel).toBe("FounderFirst");
    expect(usage.byApp[0].useCases[0].useCase).toBe("penny_categorize");

    const suqs = (await (await mockGatewayFetch("https://gateway.local/v1/suqs", { method: "GET" })).json()) as {
      byApp: Array<{ app: string; useCases: Array<{ useCase: string; calls: number; p95LatencyMs: number }> }>;
    };
    expect(suqs.byApp).toHaveLength(1);
    expect(suqs.byApp[0].app).toBe("founderfirst");
    expect(suqs.byApp[0].useCases[0].calls).toBe(1);
    expect(suqs.byApp[0].useCases[0].p95LatencyMs).toBe(900);
  });

  it("groups two apps of decisions separately", async () => {
    const post = (useCase: string, costUsd: number) =>
      mockGatewayFetch("https://gateway.local/v1/decisions", {
        method: "POST",
        body: JSON.stringify({ useCase, model: "m", costUsd, latencyMs: 800, gateStatus: "pass", at: 1 }),
      });
    await post("penny_categorize", 0.002); // founderfirst
    await post("detect", 0.003); // rally

    const usage = (await (await mockGatewayFetch("https://gateway.local/v1/usage", { method: "GET" })).json()) as {
      byApp: Array<{ app: string }>;
    };
    expect(usage.byApp.map((a) => a.app)).toEqual(["founderfirst", "rally"]);
  });

  it("serves the merged catalog and profiles for every use case", async () => {
    const all = await mockGatewayFetch("https://gateway.local/v1/models", { method: "GET" });
    const allBody = (await all.json()) as { models: Array<{ provider: string }>; recommended?: string[] };
    expect(new Set(allBody.models.map((m) => m.provider)).size).toBeGreaterThan(1);
    expect(allBody.recommended).toBeUndefined();

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ id: string; routing: { main: string } }> };
    expect(body.profiles.length).toBe(USE_CASES.length);
    for (const p of body.profiles) expect(p.routing.main).toBeTruthy();
  });

  it("routes infer to the pinned model", async () => {
    const res = await mockGatewayFetch("https://gateway.local/v1/infer", {
      method: "POST",
      body: JSON.stringify({ useCase: "penny_insights", pinModel: { provider: "anthropic", model: "claude-sonnet-5" } }),
    });
    const body = (await res.json()) as { provider: string; model: string };
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-sonnet-5");
  });
});
