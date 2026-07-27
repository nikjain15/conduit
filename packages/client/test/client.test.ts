import { describe, expect, it, vi } from "vitest";
import { createClient, ConduitError } from "../src/index.ts";
import type {
  EmbeddedCore,
  FetchLike,
  HttpResponseLike,
} from "../src/index.ts";

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Records the last call and returns a queued response. */
function mockFetch(response: HttpResponseLike): {
  fetch: FetchLike;
  calls: { url: string; init?: Parameters<FetchLike>[1] }[];
} {
  const calls: { url: string; init?: Parameters<FetchLike>[1] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { fetch, calls };
}

function makeCore(overrides: Partial<EmbeddedCore> = {}): EmbeddedCore {
  return {
    resolve: async (task) => ({
      text: `answer for ${task.useCase}`,
      model: { provider: "anthropic", model: "claude-opus-4-8" },
      providerModel: "claude-opus-4-8-20260101",
      costUsd: 0.42,
      latencyMs: 123,
      decisionId: "dec_1",
    }),
    retrieve: async ({ query }) => ({
      chunks: [{ id: "c1", score: 0.9, text: `about ${query}` }],
      grounded: true,
    }),
    runAgent: async ({ goal }) => ({ answer: `did ${goal}`, steps: [{ step: 1 }] }),
    evaluate: async ({ datasetId }) => ({
      summary: `ran ${datasetId}`,
      metrics: { accuracy: 1 },
    }),
    usage: async () => ({
      totalCostUsd: 5,
      byApp: [
        {
          app: "founderfirst",
          appLabel: "FounderFirst",
          totalCostUsd: 5,
          useCases: [{ useCase: "chat", costUsd: 5 }],
        },
      ],
    }),
    ...overrides,
  };
}

/* ── Embedded mode ────────────────────────────────────────────────────────── */

describe("embedded mode", () => {
  it("infer calls the injected resolve and maps to the unified shape", async () => {
    const resolve = vi.fn(makeCore().resolve);
    const client = createClient({ mode: "embedded", core: makeCore({ resolve }) });

    const out = await client.infer({
      useCase: "chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(resolve).toHaveBeenCalledTimes(1);
    const task = resolve.mock.calls[0][0];
    expect(task.useCase).toBe("chat");
    // Defaults are applied by the embedded transport.
    expect(task.tenantId).toBe("org:example");
    expect(task.maxTokens).toBe(1024);

    expect(out).toEqual({
      output: "answer for chat",
      model: "claude-opus-4-8-20260101",
      provider: "anthropic",
      costUsd: 0.42,
      latencyMs: 123,
      decisionId: "dec_1",
    });
  });

  it("infer honors configured tenantId / defaultMaxTokens and explicit maxTokens", async () => {
    const resolve = vi.fn(makeCore().resolve);
    const client = createClient({
      mode: "embedded",
      core: makeCore({ resolve }),
      tenantId: "org:acme",
      defaultMaxTokens: 256,
    });

    await client.infer({ useCase: "chat", messages: [] });
    expect(resolve.mock.calls[0][0].tenantId).toBe("org:acme");
    expect(resolve.mock.calls[0][0].maxTokens).toBe(256);

    await client.infer({ useCase: "chat", messages: [], maxTokens: 4096 });
    expect(resolve.mock.calls[1][0].maxTokens).toBe(4096);
  });

  it("infer falls back to model.model when providerModel is absent", async () => {
    const client = createClient({
      mode: "embedded",
      core: makeCore({
        resolve: async () => ({
          text: "x",
          model: { provider: "workers-ai", model: "llama-3" },
          costUsd: 0,
          latencyMs: 1,
        }),
      }),
    });
    const out = await client.infer({ useCase: "chat", messages: [] });
    expect(out.model).toBe("llama-3");
    expect(out.provider).toBe("workers-ai");
    expect(out.decisionId).toBeUndefined();
  });

  it("retrieve / runAgent / evaluate / usage return the injected core shapes", async () => {
    const client = createClient({ mode: "embedded", core: makeCore() });
    expect(await client.retrieve({ query: "q" })).toEqual({
      chunks: [{ id: "c1", score: 0.9, text: "about q" }],
      grounded: true,
    });
    expect(await client.runAgent({ goal: "g" })).toEqual({
      answer: "did g",
      steps: [{ step: 1 }],
    });
    expect(await client.evaluate({ datasetId: "d" })).toEqual({
      summary: "ran d",
      metrics: { accuracy: 1 },
    });
    expect(await client.usage()).toEqual({
      totalCostUsd: 5,
      byApp: [
        {
          app: "founderfirst",
          appLabel: "FounderFirst",
          totalCostUsd: 5,
          useCases: [{ useCase: "chat", costUsd: 5 }],
        },
      ],
    });
  });
});

/* ── Gateway mode ─────────────────────────────────────────────────────────── */

describe("gateway mode", () => {
  const gatewayCfg = (fetch: FetchLike) =>
    ({
      mode: "gateway" as const,
      apiKey: "sk-test-123",
      baseUrl: "https://gw.conduit.dev/",
      fetch,
    });

  it("infer builds POST /v1/infer with auth header and JSON body, parses response", async () => {
    const responseBody = {
      output: "hello",
      model: "claude-opus-4-8",
      provider: "anthropic",
      costUsd: 0.1,
      latencyMs: 50,
      decisionId: "dec_9",
    };
    const { fetch, calls } = mockFetch(jsonResponse(responseBody));
    const client = createClient(gatewayCfg(fetch));

    const params = {
      useCase: "chat",
      messages: [{ role: "user" as const, content: "hi" }],
      system: "be nice",
      maxTokens: 512,
    };
    const out = await client.infer(params);

    expect(calls).toHaveLength(1);
    // Trailing slash on baseUrl is normalized (no double slash).
    expect(calls[0].url).toBe("https://gw.conduit.dev/v1/infer");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers?.Authorization).toBe("Bearer sk-test-123");
    expect(calls[0].init?.headers?.["Content-Type"]).toBe("application/json");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual(params);

    expect(out).toEqual(responseBody);
  });

  it("routes each method to its contract endpoint", async () => {
    async function urlFor(
      call: (c: ReturnType<typeof createClient>) => Promise<unknown>,
    ): Promise<{ url: string; method?: string }> {
      const { fetch, calls } = mockFetch(jsonResponse({}));
      const client = createClient(gatewayCfg(fetch));
      await call(client);
      return { url: calls[0].url, method: calls[0].init?.method };
    }

    expect(await urlFor((c) => c.retrieve({ query: "q" }))).toEqual({
      url: "https://gw.conduit.dev/v1/retrieve",
      method: "POST",
    });
    expect(await urlFor((c) => c.runAgent({ goal: "g" }))).toEqual({
      url: "https://gw.conduit.dev/v1/agent",
      method: "POST",
    });
    expect(await urlFor((c) => c.evaluate({ datasetId: "d" }))).toEqual({
      url: "https://gw.conduit.dev/v1/evals/run",
      method: "POST",
    });
  });

  it("usage is a GET with the window query param and no body", async () => {
    const { fetch, calls } = mockFetch(
      jsonResponse({ totalCostUsd: 2, byApp: [] }),
    );
    const client = createClient(gatewayCfg(fetch));
    await client.usage({ window: "7d" });

    expect(calls[0].url).toBe("https://gw.conduit.dev/v1/usage?window=7d");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("profiles is a GET with the useCase query param and no body", async () => {
    const { fetch, calls } = mockFetch(jsonResponse({ profiles: [] }));
    const client = createClient(gatewayCfg(fetch));
    await client.profiles?.({ useCase: "kb-search" });

    expect(calls[0].url).toBe("https://gw.conduit.dev/v1/profiles?useCase=kb-search");
    expect(calls[0].init?.method).toBe("GET");
    expect(calls[0].init?.body).toBeUndefined();
  });

  it("a non-ok HTTP response surfaces as a structured ConduitError", async () => {
    const { fetch } = mockFetch(
      jsonResponse({ error: "unauthorized" }, 401),
    );
    const client = createClient(gatewayCfg(fetch));

    const err = await client
      .infer({ useCase: "chat", messages: [] })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConduitError);
    const ce = err as ConduitError;
    expect(ce.status).toBe(401);
    expect(ce.body).toEqual({ error: "unauthorized" });
    expect(ce.name).toBe("ConduitError");
    expect(ce.message).toContain("401");
  });
});

/* ── Mode is transport-only: same surface either way ──────────────────────── */

describe("switching mode changes transport, not the surface", () => {
  it("both clients expose the identical method set", () => {
    const embedded = createClient({ mode: "embedded", core: makeCore() });
    const { fetch } = mockFetch(jsonResponse({}));
    const gateway = createClient({
      mode: "gateway",
      apiKey: "k",
      baseUrl: "https://gw",
      fetch,
    });

    const surface = (c: typeof embedded) =>
      ["infer", "retrieve", "runAgent", "evaluate", "usage"].every(
        (m) => typeof (c as unknown as Record<string, unknown>)[m] === "function",
      );

    expect(embedded.mode).toBe("embedded");
    expect(gateway.mode).toBe("gateway");
    expect(surface(embedded)).toBe(true);
    expect(surface(gateway)).toBe(true);
  });

  it("infer returns the same result shape from both modes", async () => {
    const embedded = createClient({ mode: "embedded", core: makeCore() });
    const { fetch } = mockFetch(
      jsonResponse({
        output: "answer for chat",
        model: "claude-opus-4-8-20260101",
        provider: "anthropic",
        costUsd: 0.42,
        latencyMs: 123,
        decisionId: "dec_1",
      }),
    );
    const gateway = createClient({
      mode: "gateway",
      apiKey: "k",
      baseUrl: "https://gw",
      fetch,
    });

    const a = await embedded.infer({ useCase: "chat", messages: [] });
    const b = await gateway.infer({ useCase: "chat", messages: [] });
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect(a).toEqual(b);
  });
});
