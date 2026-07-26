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
    for (const label of ["Overview", "Models", "Prompts", "Guardrails", "Agent", "Eval setup", "Retrieval", "Cost dashboards", "SUQS SLOs"]) {
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

describe("Prompts editor", () => {
  it("renders the active use case prompt values and a resolved preview", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Prompts" }));
    await waitFor(() => expect(screen.getByLabelText("System prompt reference")).toBeTruthy());

    // The first use case is support-triage; its systemRef is registered.
    const ref = screen.getByLabelText("System prompt reference") as HTMLInputElement;
    expect(ref.value).toBe("support-triage.system");
    // The resolver preview renders the composed system text.
    expect(screen.getByText("Resolved system prompt")).toBeTruthy();
  });

  it("round-trips an edited systemRef through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Prompts" }));
    await waitFor(() => expect(screen.getByLabelText("System prompt reference")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("System prompt reference"), {
      target: { value: "kb-search.system" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=support-triage", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ prompt: { systemRef: string } }> };
    expect(body.profiles[0].prompt.systemRef).toBe("kb-search.system");
  });
});

describe("Guardrails editor", () => {
  it("renders the active use case guardrails values and its eval keys as floors", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await waitFor(() => expect(screen.getByLabelText("Injection guard")).toBeTruthy());

    // support-triage has pii and injectionGuard on in the sample data.
    expect((screen.getByLabelText("PII protection") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Injection guard") as HTMLInputElement).checked).toBe(true);
    // Its eval keys are offered as floor checkboxes.
    expect(screen.getByLabelText("Floor pii-block")).toBeTruthy();
  });

  it("round-trips a toggled injection guard through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Guardrails" }));
    await waitFor(() => expect(screen.getByLabelText("Injection guard")).toBeTruthy());

    fireEvent.click(screen.getByLabelText("Injection guard")); // turn it off
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=support-triage", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ guardrails: { injectionGuard?: boolean } }> };
    expect(body.profiles[0].guardrails.injectionGuard).toBe(false);
  });
});

describe("Retrieval editor", () => {
  it("renders the active use case config and notes when retrieval is disabled", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Enable retrieval")).toBeTruthy());

    // The first use case is support-triage, which has no retrieval block.
    expect((screen.getByLabelText("Enable retrieval") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(/Retrieval is disabled for this use case/)).toBeTruthy();
  });

  it("renders the config for a use case that has retrieval on", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Enable retrieval")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Use case"), { target: { value: "kb-search" } });
    expect((screen.getByLabelText("Enable retrieval") as HTMLInputElement).checked).toBe(true);
    // kb-search sample config uses topK 6.
    expect((screen.getByLabelText("Top K") as HTMLInputElement).value).toBe("6");
  });

  it("round-trips an edited topK through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Enable retrieval")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Use case"), { target: { value: "kb-search" } });
    fireEvent.change(screen.getByLabelText("Top K"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=kb-search", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ retrieval: { topK: number } }> };
    expect(body.profiles[0].retrieval.topK).toBe(9);
  });

  it("toggling enable off nulls the retrieval block through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Retrieval" }));
    await waitFor(() => expect(screen.getByLabelText("Enable retrieval")).toBeTruthy());

    // billing-summary has retrieval on in the sample data; turn it off.
    fireEvent.change(screen.getByLabelText("Use case"), { target: { value: "billing-summary" } });
    expect((screen.getByLabelText("Enable retrieval") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText("Enable retrieval"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=billing-summary", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ retrieval: unknown }> };
    expect(body.profiles[0].retrieval).toBe(null);
  });
});

describe("Agent editor", () => {
  it("renders the active use case agent config", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await waitFor(() => expect(screen.getByLabelText("Enable agent")).toBeTruthy());

    // The first use case is support-triage: agent on, single mode.
    expect((screen.getByLabelText("Enable agent") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("single");
    // Its one tool is checked; a tool it does not name is not.
    expect((screen.getByLabelText("Tool classify-intent") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Tool read-diff") as HTMLInputElement).checked).toBe(false);
  });

  it("shows max steps only in loop mode", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await waitFor(() => expect(screen.getByLabelText("Mode")).toBeTruthy());

    // support-triage starts in single mode: no max steps field.
    expect(screen.queryByLabelText("Max steps")).toBeNull();
    // Switching to loop reveals it.
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "loop" } });
    expect(screen.getByLabelText("Max steps")).toBeTruthy();
    // Back to single hides it again.
    fireEvent.change(screen.getByLabelText("Mode"), { target: { value: "single" } });
    expect(screen.queryByLabelText("Max steps")).toBeNull();
  });

  it("round-trips a toggled tool through updateProfile", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("tab", { name: "Agent" }));
    await waitFor(() => expect(screen.getByLabelText("Enable agent")).toBeTruthy());

    // Add read-diff to support-triage and save.
    fireEvent.click(screen.getByLabelText("Tool read-diff"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/round-trip through the gateway/)).toBeTruthy());

    const res = await mockGatewayFetch("https://gateway.local/v1/profiles?useCase=support-triage", { method: "GET" });
    const body = (await res.json()) as { profiles: Array<{ agent: { tools: string[] } }> };
    expect(body.profiles[0].agent.tools).toContain("read-diff");
    expect(body.profiles[0].agent.tools).toContain("classify-intent");
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
