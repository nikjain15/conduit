/**
 * Gateway router tests. They call `route()` directly with injected fakes, so no
 * port is bound, no clock is read live, and no core does real work. Each test
 * asserts real behavior: auth, tenant isolation, metering, aggregation, routing.
 */
import { describe, it, expect } from "vitest";
import { route } from "../src/router";
import { buildGatewayTools } from "../src/mcp";
import { MemoryMeterSink } from "../src/metering";
import type { CatalogModel } from "@conduit/catalog";
import type {
  CatalogSource,
  Decision,
  GatewayDeps,
  InferResult,
  InferTask,
  ModelsResult,
  ParsedRequest,
  Tenant,
} from "../src/types";

const TENANT_A: Tenant = { id: "tenant-a", name: "Acme" };
const TENANT_B: Tenant = { id: "tenant-b", name: "Beta" };

const KEYS: Record<string, Tenant> = {
  "key-a": TENANT_A,
  "key-b": TENANT_B,
};

interface Fakes {
  deps: GatewayDeps;
  meter: MemoryMeterSink;
  inferCalls: Array<{ task: InferTask; tenant: Tenant }>;
}

function makeDeps(overrides: Partial<GatewayDeps> = {}): Fakes {
  const meter = new MemoryMeterSink();
  const inferCalls: Array<{ task: InferTask; tenant: Tenant }> = [];

  const deps: GatewayDeps = {
    lookupTenant: (apiKey) => KEYS[apiKey] ?? null,
    meter,
    now: () => 1_000_000,
    async infer(task, tenant): Promise<InferResult> {
      inferCalls.push({ task, tenant });
      return {
        output: `answer for ${task.useCase}`,
        model: "claude-haiku-4-5",
        provider: "anthropic",
        costUsd: 0.002,
        latencyMs: 42,
        decisionId: "dec-1",
      };
    },
    async retrieve(task, _tenant) {
      return { chunks: [{ id: "c1", text: task.query, score: 0.9 }], grounded: true };
    },
    async runAgent(task, _tenant) {
      return { answer: `did ${task.goal}`, steps: [{ action: "noop" }] };
    },
    async evaluate(task, _tenant) {
      return { summary: `ran ${task.datasetId}`, metrics: { pass: 1 } };
    },
    ...overrides,
  };
  return { deps, meter, inferCalls };
}

function req(partial: Partial<ParsedRequest> & Pick<ParsedRequest, "method" | "path">): ParsedRequest {
  return {
    query: new URLSearchParams(),
    headers: {},
    body: undefined,
    ...partial,
  };
}

function bearer(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}` };
}

describe("gateway router", () => {
  it("serves /healthz without auth", async () => {
    const { deps } = makeDeps();
    const res = await route(req({ method: "GET", path: "/healthz" }), deps);
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
  });

  it("rejects /v1/infer with no bearer token as 401", async () => {
    const { deps, inferCalls } = makeDeps();
    const res = await route(
      req({ method: "POST", path: "/v1/infer", body: { useCase: "summarize", messages: [] } }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(inferCalls).toHaveLength(0);
  });

  it("rejects an unknown bearer key as 401", async () => {
    const { deps } = makeDeps();
    const res = await route(
      req({
        method: "POST",
        path: "/v1/infer",
        headers: bearer("nope"),
        body: { useCase: "summarize", messages: [] },
      }),
      deps,
    );
    expect(res.status).toBe(401);
  });

  it("calls infer scoped to the resolved tenant and returns the contract shape", async () => {
    const { deps, inferCalls } = makeDeps();
    const res = await route(
      req({
        method: "POST",
        path: "/v1/infer",
        headers: bearer("key-a"),
        body: {
          useCase: "summarize",
          messages: [{ role: "user", content: "hi" }],
          system: "be terse",
        },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      output: "answer for summarize",
      model: "claude-haiku-4-5",
      provider: "anthropic",
      costUsd: 0.002,
      latencyMs: 42,
      decisionId: "dec-1",
    });
    expect(inferCalls).toHaveLength(1);
    expect(inferCalls[0].tenant).toEqual(TENANT_A);
    expect(inferCalls[0].task.system).toBe("be terse");
  });

  it("ignores a client-supplied tenant field and uses the key's tenant", async () => {
    const { deps, inferCalls } = makeDeps();
    await route(
      req({
        method: "POST",
        path: "/v1/infer",
        headers: bearer("key-a"),
        body: {
          useCase: "summarize",
          messages: [{ role: "user", content: "hi" }],
          tenant: "tenant-b",
          tenantId: "tenant-b",
        },
      }),
      deps,
    );
    expect(inferCalls[0].tenant.id).toBe("tenant-a");
  });

  it("records a decision on infer and aggregates it per useCase in /v1/usage", async () => {
    const { deps, meter } = makeDeps();
    const infer = (useCase: string) =>
      route(
        req({
          method: "POST",
          path: "/v1/infer",
          headers: bearer("key-a"),
          body: { useCase, messages: [{ role: "user", content: "x" }] },
        }),
        deps,
      );
    await infer("summarize");
    await infer("summarize");
    await infer("classify");

    const recorded = meter.list("tenant-a");
    expect(recorded).toHaveLength(3);
    expect(recorded.every((d: Decision) => d.tenant === "tenant-a" && d.at === 1_000_000)).toBe(true);

    const usage = await route(
      req({ method: "GET", path: "/v1/usage", headers: bearer("key-a") }),
      deps,
    );
    expect(usage.status).toBe(200);
    expect(usage.json).toEqual({
      totalCostUsd: 0.006,
      byUseCase: [
        { useCase: "classify", calls: 1, costUsd: 0.002 },
        { useCase: "summarize", calls: 2, costUsd: 0.004 },
      ],
    });
  });

  it("isolates usage per tenant", async () => {
    const { deps } = makeDeps();
    await route(
      req({
        method: "POST",
        path: "/v1/infer",
        headers: bearer("key-a"),
        body: { useCase: "summarize", messages: [] },
      }),
      deps,
    );
    const usageB = await route(
      req({ method: "GET", path: "/v1/usage", headers: bearer("key-b") }),
      deps,
    );
    expect(usageB.json).toEqual({ totalCostUsd: 0, byUseCase: [] });
  });

  it("routes retrieve, agent, and evals to their injected cores", async () => {
    const { deps } = makeDeps();
    const r = await route(
      req({ method: "POST", path: "/v1/retrieve", headers: bearer("key-a"), body: { query: "q" } }),
      deps,
    );
    expect(r.json).toMatchObject({ grounded: true });

    const a = await route(
      req({ method: "POST", path: "/v1/agent", headers: bearer("key-a"), body: { goal: "ship" } }),
      deps,
    );
    expect(a.json).toMatchObject({ answer: "did ship" });

    const e = await route(
      req({ method: "POST", path: "/v1/evals/run", headers: bearer("key-a"), body: { datasetId: "d1" } }),
      deps,
    );
    expect(e.json).toMatchObject({ summary: "ran d1" });
  });

  it("returns 404 for an unknown route", async () => {
    const { deps } = makeDeps();
    const res = await route(
      req({ method: "GET", path: "/v1/nope", headers: bearer("key-a") }),
      deps,
    );
    expect(res.status).toBe(404);
  });

  it("exposes MCP tools bound to a tenant that delegate to the cores", async () => {
    const { deps, inferCalls } = makeDeps();
    const tools = buildGatewayTools(deps, TENANT_B);
    expect(tools.map((t) => t.name).sort()).toEqual(["agent", "evals_run", "infer", "retrieve"]);

    const inferTool = tools.find((t) => t.name === "infer")!;
    const result = await inferTool.handler({
      useCase: "summarize",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.structuredContent).toMatchObject({ model: "claude-haiku-4-5" });
    expect(inferCalls[0].tenant).toEqual(TENANT_B);
  });

  it("returns 400 when required fields are missing", async () => {
    const { deps } = makeDeps();
    const res = await route(
      req({ method: "POST", path: "/v1/infer", headers: bearer("key-a"), body: { messages: [] } }),
      deps,
    );
    expect(res.status).toBe(400);
  });
});

function model(partial: Partial<CatalogModel> & Pick<CatalogModel, "ref" | "id">): CatalogModel {
  return {
    name: partial.id,
    provider: "openrouter",
    contextLength: 8000,
    promptPerMTok: 1,
    completionPerMTok: 1,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: true,
    supportsTools: true,
    ...partial,
  };
}

const OR_MODELS: CatalogModel[] = [
  model({ ref: "openrouter/cheap", id: "cheap", promptPerMTok: 0.1, contextLength: 200000 }),
  model({ ref: "openrouter/pricey", id: "pricey", promptPerMTok: 9, contextLength: 200000 }),
];
const CURATED: CatalogModel[] = [
  model({ ref: "anthropic/claude-haiku-4-5", id: "claude-haiku-4-5", provider: "anthropic", contextLength: 200000 }),
];

function makeCatalog(): { source: CatalogSource; fetchCount: () => number } {
  let count = 0;
  const source: CatalogSource = {
    async fetchOpenRouter() {
      count += 1;
      return OR_MODELS;
    },
    curated: CURATED,
  };
  return { source, fetchCount: () => count };
}

describe("GET /v1/models", () => {
  it("rejects without a bearer token as 401", async () => {
    const { source } = makeCatalog();
    const { deps } = makeDeps({ catalog: source });
    const res = await route(req({ method: "GET", path: "/v1/models" }), deps);
    expect(res.status).toBe(401);
  });

  it("returns the merged OpenRouter and curated models", async () => {
    const { source } = makeCatalog();
    const { deps } = makeDeps({ catalog: source });
    const res = await route(req({ method: "GET", path: "/v1/models", headers: bearer("key-a") }), deps);
    expect(res.status).toBe(200);
    const body = res.json as ModelsResult;
    const refs = body.models.map((m) => m.ref);
    expect(refs).toContain("openrouter/cheap");
    expect(refs).toContain("openrouter/pricey");
    expect(refs).toContain("anthropic/claude-haiku-4-5");
    expect(body.recommended).toBeUndefined();
  });

  it("returns recommended refs for a known useCase", async () => {
    const { source } = makeCatalog();
    const { deps } = makeDeps({ catalog: source });
    const res = await route(
      req({
        method: "GET",
        path: "/v1/models",
        query: new URLSearchParams({ useCase: "support-triage" }),
        headers: bearer("key-a"),
      }),
      deps,
    );
    const body = res.json as ModelsResult;
    // support-triage is high cost sensitivity -> cheapest first.
    expect(body.recommended?.[0]).toBe("openrouter/cheap");
    expect(body.recommended).toContain("openrouter/pricey");
  });

  it("caches the OpenRouter fetch within the TTL and refreshes after it", async () => {
    const { source, fetchCount } = makeCatalog();
    let clock = 1_000_000;
    const { deps } = makeDeps({ catalog: source, now: () => clock });
    const call = () => route(req({ method: "GET", path: "/v1/models", headers: bearer("key-a") }), deps);
    await call();
    await call();
    expect(fetchCount()).toBe(1);
    clock += 2 * 60 * 60 * 1000; // advance past the ~1h TTL
    await call();
    expect(fetchCount()).toBe(2);
  });

  it("ignores an api key supplied in the request body", async () => {
    const { source } = makeCatalog();
    const { deps } = makeDeps({ catalog: source });
    const res = await route(
      req({
        method: "GET",
        path: "/v1/models",
        headers: bearer("key-a"),
        body: { apiKey: "sk-attacker", openRouterKey: "sk-attacker" },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const body = res.json as ModelsResult;
    // The catalog came only from the injected source; nothing in the body
    // changed the result.
    expect(body.models.map((m) => m.ref)).toContain("openrouter/cheap");
  });
});
