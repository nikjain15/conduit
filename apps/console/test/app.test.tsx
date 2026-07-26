// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { App } from "../src/App.tsx";
import { mockGatewayFetch } from "../src/data/mockGateway.ts";
import { MODEL_CONFIG, USE_CASES } from "../src/data/sample.ts";

afterEach(cleanup);

describe("console shell", () => {
  it("renders the masthead and every section tab", () => {
    render(<App />);
    expect(screen.getByText("Conduit console")).toBeTruthy();
    for (const label of ["Overview", "Models", "Eval setup", "Cost dashboards", "SUQS SLOs"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
  });

  it("switches to the Models tab and shows a per use case card", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));
    expect(screen.getByText("Support triage")).toBeTruthy();
    expect(screen.getAllByText("Main model").length).toBe(USE_CASES.length);
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
