// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { builtInMethodNames } from "@conduit/evals";
import { App } from "../src/App.tsx";
import { mockGatewayFetch } from "../src/data/mockGateway.ts";
import { MODEL_CONFIG, USE_CASES } from "../src/data/sample.ts";

afterEach(cleanup);

describe("console shell", () => {
  it("renders the masthead and every section tab", () => {
    render(<App />);
    expect(screen.getByText("Conduit console")).toBeTruthy();
    for (const label of ["Overview", "Models", "Prompts", "Guardrails", "Agent", "Eval setup", "Cost dashboards", "SUQS SLOs"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("switches to the Guardrails tab and shows the editor coming note", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    expect(screen.getByText("Editor coming in this section.")).toBeTruthy();
  });

  it("switches to the Models tab and shows a per use case card", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));
    expect(screen.getByText("Support triage")).toBeTruthy();
    expect(screen.getAllByText("Main model").length).toBe(USE_CASES.length);
  });
});

describe("Eval setup editor", () => {
  it("renders the active use case specs and a registry-backed method dropdown", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Eval setup" }));

    // Profiles load asynchronously through the mock gateway.
    await waitFor(() => expect(screen.getByText("Inline gates")).toBeTruthy());

    // Every built-in method name appears as an option in the method dropdowns.
    const methodSelects = screen.getAllByLabelText("Method");
    expect(methodSelects.length).toBeGreaterThan(0);
    const optionValues = new Set(
      within(methodSelects[0] as HTMLSelectElement)
        .getAllByRole("option")
        .map((o) => (o as HTMLOptionElement).value),
    );
    for (const name of builtInMethodNames) expect(optionValues.has(name)).toBe(true);
  });

  it("adds a spec when the add button is clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Eval setup" }));
    await waitFor(() => expect(screen.getByText("Inline gates")).toBeTruthy());

    const before = screen.getAllByLabelText("Gate key").length;
    fireEvent.click(screen.getByRole("button", { name: "Add inline gate" }));
    const after = screen.getAllByLabelText("Gate key").length;
    expect(after).toBe(before + 1);
  });
});

describe("mock gateway profile round-trip", () => {
  it("persists an edited profile through PUT and serves it back", async () => {
    const getRes = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=kb-search", { method: "GET" });
    const { profiles } = (await getRes.json()) as { profiles: Array<{ id: string; evals?: unknown[] }> };
    const profile = profiles[0];
    const edited = { ...profile, evals: [{ key: "new-gate", method: "pii_scan", when: "inline", mandatory: true, floor: true }] };

    const putRes = await mockGatewayFetch("https://gateway.local/v1/profiles/kb-search", {
      method: "PUT",
      body: JSON.stringify(edited),
    });
    expect(putRes.ok).toBe(true);

    const afterRes = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=kb-search", { method: "GET" });
    const after = (await afterRes.json()) as { profiles: Array<{ evals: Array<{ key: string }> }> };
    expect(after.profiles[0].evals).toHaveLength(1);
    expect(after.profiles[0].evals[0].key).toBe("new-gate");
  });
});

describe("caching policy", () => {
  it("locks caching off for customer facing and financial use cases", () => {
    const billing = MODEL_CONFIG.find((c) => c.useCaseId === "billing-summary");
    const uc = USE_CASES.find((u) => u.id === "billing-summary");
    expect(uc?.cachingAllowed).toBe(false);
    expect(billing?.reuseCachedAnswers).toBe(false);
  });
});

describe("mock gateway", () => {
  it("returns sample usage totalling the per use case spend", async () => {
    const res = await mockGatewayFetch("https://gateway.local/v1/usage", { method: "GET" });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { totalCostUsd: number; byUseCase: Record<string, number> };
    const sum = Object.values(body.byUseCase).reduce((a, b) => a + b, 0);
    expect(body.totalCostUsd).toBe(sum);
  });

  it("serves the merged catalog and recommends per use case", async () => {
    const all = await mockGatewayFetch("https://gateway.local/v1/models", { method: "GET" });
    const allBody = (await all.json()) as { models: Array<{ ref: string; provider: string }>; recommended?: string[] };
    const providers = new Set(allBody.models.map((m) => m.provider));
    expect(providers.has("openrouter")).toBe(true);
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("workers-ai")).toBe(true);
    expect(allBody.recommended).toBeUndefined();

    const scoped = await mockGatewayFetch("https://gateway.local/v1/models?useCase=support-triage", { method: "GET" });
    const scopedBody = (await scoped.json()) as { models: unknown[]; recommended: string[] };
    expect(Array.isArray(scopedBody.recommended)).toBe(true);
    expect(scopedBody.recommended.length).toBeGreaterThan(0);
    // Every recommended ref must exist in the returned catalog.
    const refs = new Set((scopedBody.models as Array<{ ref: string }>).map((m) => m.ref));
    for (const ref of scopedBody.recommended) expect(refs.has(ref)).toBe(true);
  });

  it("serves sample profiles for every use case", async () => {
    const res = await mockGatewayFetch("https://gateway.local/v1/profiles", { method: "GET" });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { profiles: Array<{ id: string; routing: { main: string } }> };
    expect(body.profiles.length).toBe(USE_CASES.length);
    for (const p of body.profiles) expect(p.routing.main).toBeTruthy();
  });

  it("filters profiles by useCase", async () => {
    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=kb-search", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ id: string }> };
    expect(body.profiles.length).toBe(1);
    expect(body.profiles[0].id).toBe("kb-search");
  });

  it("routes infer to the pinned model", async () => {
    const res = await mockGatewayFetch("https://gateway.local/v1/infer", {
      method: "POST",
      body: JSON.stringify({ useCase: "kb-search", pinModel: { provider: "anthropic", model: "claude-sonnet-5" } }),
    });
    const body = (await res.json()) as { provider: string; model: string };
    expect(body.provider).toBe("anthropic");
    expect(body.model).toBe("claude-sonnet-5");
  });
});
