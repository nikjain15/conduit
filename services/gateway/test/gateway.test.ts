/**
 * Gateway router tests. They call `route()` directly with injected fakes, so no
 * port is bound, no clock is read live, and no core does real work. Each test
 * asserts real behavior: auth, tenant isolation, metering, aggregation, routing.
 */
import { describe, it, expect } from "vitest";
import { route } from "../src/router";
import { buildGatewayTools } from "../src/mcp";
import {
  InMemoryDecisionStore,
  DEFAULT_RETENTION,
  retentionCutoffs,
  applyRetention,
} from "../src/metering";
import type { CatalogModel } from "@conduit/catalog";
import type {
  App,
  CatalogSource,
  Decision,
  GatewayDeps,
  InferResult,
  InferTask,
  ModelsResult,
  ParsedRequest,
  Principal,
  SuqsResult,
  Tenant,
  UsageResult,
} from "../src/types";

const TENANT_A: Tenant = { id: "tenant-a", name: "Acme" };
const TENANT_B: Tenant = { id: "tenant-b", name: "Beta" };

const APP_A: App = { id: "founderfirst", label: "FounderFirst" };
const APP_B: App = { id: "rally", label: "Rally" };

// Each key resolves to a principal: a tenant and the app it calls as. Both are
// derived from the token, never the request body.
const KEYS: Record<string, Principal> = {
  "key-a": { tenant: TENANT_A, app: APP_A },
  "key-b": { tenant: TENANT_B, app: APP_B },
  // Same tenant as key-a, but a different app: two products of one tenant.
  "key-a-rally": { tenant: TENANT_A, app: { id: "rally", label: "Rally" } },
};

interface Fakes {
  deps: GatewayDeps;
  store: InMemoryDecisionStore;
  inferCalls: Array<{ task: InferTask; tenant: Tenant }>;
}

function makeDeps(overrides: Partial<GatewayDeps> = {}): Fakes {
  const store = new InMemoryDecisionStore();
  const inferCalls: Array<{ task: InferTask; tenant: Tenant }> = [];

  const deps: GatewayDeps = {
    lookupTenant: (apiKey) => KEYS[apiKey] ?? null,
    store,
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
  return { deps, store, inferCalls };
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

  it("records a decision on infer and aggregates it per app then useCase in /v1/usage", async () => {
    const { deps, store } = makeDeps();
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
    await infer("penny_categorize");
    await infer("penny_categorize");
    await infer("penny_insights");

    const recorded = store.query("tenant-a");
    expect(recorded).toHaveLength(3);
    // Every stored decision carries the app derived from the token.
    expect(
      recorded.every(
        (d: Decision) => d.tenant === "tenant-a" && d.app === "founderfirst" && d.at === 1_000_000,
      ),
    ).toBe(true);

    const usage = await route(
      req({ method: "GET", path: "/v1/usage", headers: bearer("key-a") }),
      deps,
    );
    expect(usage.status).toBe(200);
    expect(usage.json).toEqual({
      totalCostUsd: 0.006,
      byApp: [
        {
          app: "founderfirst",
          appLabel: "FounderFirst",
          totalCostUsd: 0.006,
          useCases: [
            { useCase: "penny_categorize", costUsd: 0.004 },
            { useCase: "penny_insights", costUsd: 0.002 },
          ],
        },
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
        body: { useCase: "penny_categorize", messages: [] },
      }),
      deps,
    );
    const usageB = await route(
      req({ method: "GET", path: "/v1/usage", headers: bearer("key-b") }),
      deps,
    );
    expect(usageB.json).toEqual({ totalCostUsd: 0, byApp: [] });
  });

  it("groups one tenant's decisions across two apps in /v1/usage", async () => {
    const { deps } = makeDeps();
    const infer = (key: string, useCase: string) =>
      route(
        req({
          method: "POST",
          path: "/v1/infer",
          headers: bearer(key),
          body: { useCase, messages: [{ role: "user", content: "x" }] },
        }),
        deps,
      );
    await infer("key-a", "penny_categorize");
    await infer("key-a-rally", "detect");

    const usage = (await route(
      req({ method: "GET", path: "/v1/usage", headers: bearer("key-a") }),
      deps,
    )).json as UsageResult;
    // Both apps of tenant-a appear, sorted by app id.
    expect(usage.byApp.map((a) => a.app)).toEqual(["founderfirst", "rally"]);
    expect(usage.byApp[0].useCases[0].useCase).toBe("penny_categorize");
    expect(usage.byApp[1].useCases[0].useCase).toBe("detect");
    expect(usage.totalCostUsd).toBeCloseTo(0.004, 6);
  });

  it("stamps the app from the token and ignores a body-supplied app", async () => {
    const { deps, store } = makeDeps();
    await route(
      req({
        method: "POST",
        path: "/v1/infer",
        headers: bearer("key-a"),
        body: {
          useCase: "penny_categorize",
          messages: [{ role: "user", content: "x" }],
          app: "rally",
          appLabel: "Rally",
        },
      }),
      deps,
    );
    const rows = store.query("tenant-a");
    expect(rows).toHaveLength(1);
    // The body claimed "rally" but the token resolves to founderfirst.
    expect(rows[0].app).toBe("founderfirst");
    expect(rows[0].appLabel).toBe("FounderFirst");
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

describe("POST /v1/decisions and GET /v1/suqs", () => {
  const reportedDecision = {
    useCase: "kb-search",
    model: "claude-sonnet-5",
    provider: "anthropic",
    costUsd: 0.02,
    latencyMs: 1800,
    tokensIn: 1200,
    tokensOut: 300,
    gateStatus: "pass" as const,
    at: 1_000_000,
  };

  it("rejects an unauthenticated report as 401 and stores nothing", async () => {
    const { deps, store } = makeDeps();
    const res = await route(
      req({ method: "POST", path: "/v1/decisions", body: reportedDecision }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(store.query("tenant-a")).toHaveLength(0);
  });

  it("stamps the tenant from the key, ignoring a body-supplied tenant", async () => {
    const { deps, store } = makeDeps();
    const res = await route(
      req({
        method: "POST",
        path: "/v1/decisions",
        headers: bearer("key-a"),
        body: { ...reportedDecision, tenant: "tenant-b", tenantId: "tenant-b" },
      }),
      deps,
    );
    expect(res.status).toBe(202);
    const rows = store.query("tenant-a");
    expect(rows).toHaveLength(1);
    expect(rows[0].tenant).toBe("tenant-a");
    expect(rows[0].app).toBe("founderfirst");
    expect(rows[0].useCase).toBe("kb-search");
    // Nothing landed under the attacker-supplied tenant.
    expect(store.query("tenant-b")).toHaveLength(0);
  });

  it("surfaces a reported decision grouped by app in both usage and suqs", async () => {
    const sloTargets = () => ({ p95LatencyMs: 2500, costPerAnswerUsd: 0.03, gateBlockRate: 0.05 });
    const { deps } = makeDeps({ sloTargets });
    await route(
      req({ method: "POST", path: "/v1/decisions", headers: bearer("key-a"), body: reportedDecision }),
      deps,
    );

    const usage = await route(req({ method: "GET", path: "/v1/usage", headers: bearer("key-a") }), deps);
    expect(usage.json).toEqual({
      totalCostUsd: 0.02,
      byApp: [
        {
          app: "founderfirst",
          appLabel: "FounderFirst",
          totalCostUsd: 0.02,
          useCases: [{ useCase: "kb-search", costUsd: 0.02 }],
        },
      ],
    });

    const suqs = await route(req({ method: "GET", path: "/v1/suqs", headers: bearer("key-a") }), deps);
    const body = suqs.json as SuqsResult;
    expect(body.byApp).toHaveLength(1);
    expect(body.byApp[0].app).toBe("founderfirst");
    expect(body.byApp[0].appLabel).toBe("FounderFirst");
    expect(body.byApp[0].useCases).toHaveLength(1);
    expect(body.byApp[0].useCases[0]).toEqual({
      useCase: "kb-search",
      calls: 1,
      p95LatencyMs: 1800,
      costPerAnswerUsd: 0.02,
      gateBlockRate: 0,
      target: { p95LatencyMs: 2500, costPerAnswerUsd: 0.03, gateBlockRate: 0.05 },
    });
  });

  it("computes p95, cost per answer, and gate block rate from real records", async () => {
    const { deps } = makeDeps();
    const report = (over: Record<string, unknown>) =>
      route(
        req({
          method: "POST",
          path: "/v1/decisions",
          headers: bearer("key-a"),
          body: { useCase: "support-triage", model: "m", costUsd: 0.001, latencyMs: 100, ...over },
        }),
        deps,
      );
    // Ten calls, latencies 100..1000, one blocked, total cost 0.01.
    for (let i = 1; i <= 10; i++) {
      await report({ latencyMs: i * 100, gateStatus: i === 1 ? "block" : "pass" });
    }
    const suqs = await route(req({ method: "GET", path: "/v1/suqs", headers: bearer("key-a") }), deps);
    const row = (suqs.json as SuqsResult).byApp[0].useCases[0];
    expect(row.calls).toBe(10);
    expect(row.p95LatencyMs).toBe(1000); // nearest-rank p95 of 100..1000
    expect(row.costPerAnswerUsd).toBe(0.001);
    expect(row.gateBlockRate).toBe(0.1);
    expect(row.target).toBeNull(); // no sloTargets injected
  });

  it("returns empty usage and suqs when there are no records, never invented numbers", async () => {
    const { deps } = makeDeps();
    const usage = await route(req({ method: "GET", path: "/v1/usage", headers: bearer("key-a") }), deps);
    expect(usage.json as UsageResult).toEqual({ totalCostUsd: 0, byApp: [] });

    const suqs = await route(req({ method: "GET", path: "/v1/suqs", headers: bearer("key-a") }), deps);
    expect(suqs.json as SuqsResult).toEqual({ byApp: [] });
  });

  it("isolates reported decisions per tenant in suqs", async () => {
    const { deps } = makeDeps();
    await route(
      req({ method: "POST", path: "/v1/decisions", headers: bearer("key-a"), body: reportedDecision }),
      deps,
    );
    const suqsB = await route(req({ method: "GET", path: "/v1/suqs", headers: bearer("key-b") }), deps);
    expect((suqsB.json as SuqsResult).byApp).toEqual([]);
  });

  it("rejects a report missing required fields as 400", async () => {
    const { deps } = makeDeps();
    const res = await route(
      req({ method: "POST", path: "/v1/decisions", headers: bearer("key-a"), body: { useCase: "x" } }),
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

/**
 * Retention and deletion.
 *
 * These exist because "there is no retention window and no deletion path" was a
 * true statement about this store until 2026-08-02. A written policy with no
 * code behind it is a promise; these tests are what make it a property.
 */
describe("retention", () => {
  const DAY = 86_400_000;
  const now = 1_800_000_000_000;

  function seeded(): InMemoryDecisionStore {
    const store = new InMemoryDecisionStore();
    const row = (tenant: string, at: number): Decision => ({
      tenant,
      app: "founderfirst",
      useCase: "chat",
      model: "claude-haiku-4-5",
      costUsd: 0.001,
      latencyMs: 100,
      at,
    });
    store.append(row("tenant-a", now - 10 * DAY));
    store.append(row("tenant-a", now - 500 * DAY));
    store.append(row("tenant-b", now - 401 * DAY));
    store.append(row("tenant-b", now - DAY));
    return store;
  }

  it("states a window and enforces it", () => {
    const store = seeded();
    const cutoffs = retentionCutoffs(now, DEFAULT_RETENTION);
    expect(DEFAULT_RETENTION.decisionDays).toBe(400);
    expect(cutoffs.decisions).toBe(now - 400 * DAY);

    const deleted = store.purge(cutoffs.decisions);
    expect(deleted).toBe(2);
    expect(store.query("tenant-a")).toHaveLength(1);
    expect(store.query("tenant-b")).toHaveLength(1);
  });

  it("applyRetention purges with the policy's own cutoff", async () => {
    const store = seeded();
    expect(await applyRetention(store, now)).toBe(2);
    // Running it twice deletes nothing more: purging is idempotent.
    expect(await applyRetention(store, now)).toBe(0);
  });

  it("deletes one tenant completely and leaves the others alone", () => {
    const store = seeded();
    expect(store.deleteTenant("tenant-a")).toBe(2);
    expect(store.query("tenant-a")).toEqual([]);
    expect(store.query("tenant-b")).toHaveLength(2);
  });

  it("deleting a tenant that was never seen is not an error", () => {
    expect(new InMemoryDecisionStore().deleteTenant("nobody")).toBe(0);
  });
});
