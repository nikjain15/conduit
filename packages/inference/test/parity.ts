/**
 * Phase-0 parity test, proves resolve() builds the SAME provider request each
 * live call site built before the seam, so answers are unchanged.
 *
 * It mocks the transports, captures the exact request resolve() constructs, and
 * deep-compares it (key-order-independent) to the legacy request body copied
 * verbatim from each call site. Run: `tsx packages/inference/test/parity.ts`.
 *
 * Covers all four routed sites:
 *   1. chat        (worker.ts callAnthropic)       , Anthropic
 *   2. synthesize-insights (deno fn synthesizeWithClaude), Anthropic + json_schema
 *   3. email compose     (compose.ts env.AI.run)         , Workers-AI
 *   4. insights fallback (insights.ts env.AI.run)        , Workers-AI
 */
import {
  resolve,
  buildInferenceConfig,
  DEFAULT_CONFIG,
  USE_CASE,
  TENANT_EXAMPLE,
  anonTenant,
  type ResolveCtx,
  type ChatMessage,
} from "../src/core";

/* ── helpers ──────────────────────────────────────────────────────────────── */

function sortedStringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.keys(val as object).sort().map((k) => [k, (val as Record<string, unknown>)[k]]))
      : val,
  );
}
let failures = 0;
function expectDeepEqual(label: string, actual: unknown, expected: unknown): void {
  const a = sortedStringify(actual);
  const e = sortedStringify(expected);
  if (a === e) {
    console.info(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}\n    actual:   ${a}\n    expected: ${e}`);
  }
}
function expect(label: string, cond: boolean): void {
  if (cond) console.info(`  ✓ ${label}`);
  else {
    failures++;
    console.error(`  ✗ ${label}`);
  }
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** A ctx that captures the Anthropic request instead of sending it. */
function anthropicCaptureCtx(runtime: "workers" | "deno"): {
  ctx: ResolveCtx;
  get: () => { url: string; init: { method: string; headers: Record<string, string>; body: string; signal?: unknown } };
} {
  let captured: any;
  const ctx: ResolveCtx = {
    runtime,
    config: DEFAULT_CONFIG,
    transports: {
      anthropic: {
        apiKey: "TEST_KEY",
        fetch: async (url, init) => {
          captured = { url, init };
          return {
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({
              model: "claude-echo",
              content: [{ type: "text", text: "{}" }],
              usage: { input_tokens: 1, output_tokens: 1 },
            }),
          };
        },
      },
    },
    now: () => 0,
    sleep: async () => {},
    timeoutSignal: (ms: number) => ({ __timeoutMs: ms }),
  };
  return { ctx, get: () => captured };
}

/** A ctx (workers runtime) that captures the Workers-AI run() call. */
function workersAiCaptureCtx(): { ctx: ResolveCtx; get: () => { model: string; input: any; options: any } } {
  let captured: any;
  const ctx: ResolveCtx = {
    runtime: "workers",
    config: DEFAULT_CONFIG,
    transports: {
      workersAi: {
        run: async (model, input, options) => {
          captured = { model, input, options };
          return { response: {} };
        },
      },
    },
    now: () => 0,
    sleep: async () => {},
    timeoutSignal: (ms: number) => ({ __timeoutMs: ms }),
  };
  return { ctx, get: () => captured };
}

/* ── 1. chat (Anthropic) ────────────────────────────────────────────── */

async function testChat(): Promise<void> {
  console.info("chat (worker.ts):");
  const system = "SYSTEM PROMPT";
  const messages: ChatMessage[] = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    { role: "user", content: "help" },
  ];
  const cap = anthropicCaptureCtx("workers");
  await resolve(
    {
      useCase: USE_CASE.CHAT,
      tenantId: anonTenant("sess-1"),
      system,
      messages,
      maxTokens: 600,
      // Phase 4: no pinModel, the model comes from DB routing (DEFAULT_CONFIG seed
      // = claude-haiku-4-5-20251001), proving the swap is byte-identical.
      anthropic: { betas: ["prompt-caching-2024-07-31"], cacheSystem: true, maxRetries: 2, retryBaseMs: 8_000 },
    },
    cap.ctx,
  );
  const got = cap.get();
  // Legacy body, copied verbatim from worker.ts callAnthropic:
  const legacyBody = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  };
  expect("url is api.anthropic.com", got.url === ANTHROPIC_URL);
  expectDeepEqual("request body", JSON.parse(got.init.body), legacyBody);
  expect("anthropic-version header", got.init.headers["anthropic-version"] === "2023-06-01");
  expect("prompt-caching beta header", got.init.headers["anthropic-beta"] === "prompt-caching-2024-07-31");
  expect("x-api-key header", got.init.headers["x-api-key"] === "TEST_KEY");
  expect("no timeout signal (chat)", got.init.signal === undefined);
}

/* ── 2. synthesize-insights (Anthropic + json_schema) ─────────────────────── */

async function testSynthesize(): Promise<void> {
  console.info("synthesize-insights (deno fn):");
  const system = "ANALYST SYSTEM";
  const userMsg = "Window: last 30 days...";
  const schema = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] };
  const cap = anthropicCaptureCtx("deno");
  await resolve(
    {
      useCase: USE_CASE.INSIGHTS,
      tenantId: TENANT_EXAMPLE,
      system,
      messages: [{ role: "user", content: userMsg }],
      maxTokens: 4000,
      jsonSchema: schema,
      timeoutMs: 60_000,
      anthropic: { maxRetries: 0 },
      // Phase 4: model from DB routing (seed = claude-sonnet-4-6).
    },
    cap.ctx,
  );
  const got = cap.get();
  // Legacy body, copied verbatim from synthesize-insights synthesizeWithClaude:
  const legacyBody = {
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userMsg }],
    output_config: { format: { type: "json_schema", schema } },
  };
  expect("url is api.anthropic.com", got.url === ANTHROPIC_URL);
  expectDeepEqual("request body", JSON.parse(got.init.body), legacyBody);
  expect("no prompt-caching beta", got.init.headers["anthropic-beta"] === undefined);
  expect("timeout signal present (60s)", !!got.init.signal);
}

/* ── 3. email compose (Workers-AI) ────────────────────────────────────────── */

async function testCompose(): Promise<void> {
  console.info("email compose (compose.ts):");
  const SYSTEM = "COMPOSE SYSTEM";
  const brief = "a short product update";
  const cap = workersAiCaptureCtx();
  await resolve(
    {
      useCase: USE_CASE.EMAIL_COMPOSE,
      tenantId: TENANT_EXAMPLE,
      system: SYSTEM,
      messages: [{ role: "user", content: `Brief:\n${brief.slice(0, 2000)}` }],
      maxTokens: 700,
      temperature: 0.5,
      jsonObject: true,
      // Phase 4: model from DB routing (seed = @cf/meta/llama-3.3-70b-instruct-fp8-fast).
    },
    cap.ctx,
  );
  const got = cap.get();
  // Legacy call, copied verbatim from compose.ts env.AI.run:
  const legacyModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const legacyInput = {
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Brief:\n${brief.slice(0, 2000)}` },
    ],
    max_tokens: 700,
    temperature: 0.5,
    response_format: { type: "json_object" },
  };
  expect("model", got.model === legacyModel);
  expectDeepEqual("run() input", got.input, legacyInput);
  expect("no gateway options (Phase 0 default)", got.options === undefined);
}

/* ── 4. insights fallback (Workers-AI) ────────────────────────────────────── */

async function testInsightsFallback(): Promise<void> {
  console.info("insights fallback (insights.ts):");
  const builtSystem = "INSIGHTS SYSTEM";
  const dataBlock = '{"x":1}';
  const cap = workersAiCaptureCtx();
  await resolve(
    {
      useCase: USE_CASE.INSIGHTS,
      tenantId: TENANT_EXAMPLE,
      system: builtSystem,
      messages: [{ role: "user", content: `DATA:\n${dataBlock}\n\nReturn the JSON now. Ground every finding in the available metrics.` }],
      maxTokens: 1400,
      temperature: 0.2,
      jsonObject: true,
      pinModel: { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    },
    cap.ctx,
  );
  const got = cap.get();
  const legacyInput = {
    messages: [
      { role: "system", content: builtSystem },
      { role: "user", content: `DATA:\n${dataBlock}\n\nReturn the JSON now. Ground every finding in the available metrics.` },
    ],
    max_tokens: 1400,
    temperature: 0.2,
    response_format: { type: "json_object" },
  };
  expectDeepEqual("run() input", got.input, legacyInput);
}

/* ── 5. invariants ────────────────────────────────────────────────────────── */

async function testInvariants(): Promise<void> {
  console.info("invariants:");
  // tenant_id is required (D15)
  let threw = false;
  try {
    await resolve(
      { useCase: USE_CASE.CHAT, tenantId: "", messages: [{ role: "user", content: "x" }], maxTokens: 1, pinModel: { provider: "anthropic", model: "m" } },
      anthropicCaptureCtx("workers").ctx,
    );
  } catch {
    threw = true;
  }
  expect("empty tenant_id throws", threw);

  // workers-ai refused off the workers runtime (deno/node)
  let refused = false;
  try {
    const cap = anthropicCaptureCtx("deno");
    await resolve(
      { useCase: USE_CASE.EMAIL_COMPOSE, tenantId: TENANT_EXAMPLE, messages: [{ role: "user", content: "x" }], maxTokens: 1, pinModel: { provider: "workers-ai", model: "@cf/x" } },
      cap.ctx,
    );
  } catch {
    refused = true;
  }
  expect("@cf/* refused on deno runtime", refused);
}

/* ── 6. Phase 4, DB-backed config: routing, cap fallback, cache gate ───────── */

async function testPhase4(): Promise<void> {
  console.info("Phase 4 (DB-backed config):");

  // buildInferenceConfig layers DB rows over the seed defaults.
  const cfg = buildInferenceConfig({
    config: [
      {
        use_case: USE_CASE.CHAT, runtime: "workers",
        customer_facing: true, financial: false,
        main: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
        backup: { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
        cache_enabled: true, monthly_cap_usd: 0, spend_mtd_usd: 5, // spend >= cap → fallback
      },
      {
        use_case: USE_CASE.EMAIL_COMPOSE, runtime: "workers",
        customer_facing: false, financial: false,
        main: { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
        backup: null, cache_enabled: true, monthly_cap_usd: null, spend_mtd_usd: 0,
      },
    ],
    prices: {},
  });
  expect("routing built from DB", cfg.routing[USE_CASE.CHAT].model === "claude-haiku-4-5-20251001");
  expect("meta backup present", cfg.meta?.[USE_CASE.CHAT]?.backup?.provider === "workers-ai");
  expect("seed price preserved (merge)", cfg.prices["claude-sonnet-4-6"]?.outputPerMTok === 15);

  // Cap fallback: spend(5) >= cap(0) with a backup → resolve swaps to the backup.
  const capHit = workersAiCaptureCtx();
  capHit.ctx.config = cfg;
  capHit.ctx.gateway = { accountId: "a", gatewayId: "g" };
  await resolve(
    { useCase: USE_CASE.CHAT, tenantId: anonTenant("s"), messages: [{ role: "user", content: "x" }], maxTokens: 10 },
    capHit.ctx,
  );
  expect("cap fallback → backup model", capHit.get().model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  expect("customer-facing skips cache even when enabled", capHit.get().options?.gateway?.skipCache === true);

  // Cache allowed for a non-customer-facing, non-financial use case with cache on.
  const cacheable = workersAiCaptureCtx();
  cacheable.ctx.config = cfg;
  cacheable.ctx.gateway = { accountId: "a", gatewayId: "g" };
  await resolve(
    { useCase: USE_CASE.EMAIL_COMPOSE, tenantId: TENANT_EXAMPLE, messages: [{ role: "user", content: "x" }], maxTokens: 10 },
    cacheable.ctx,
  );
  expect("cache allowed for non-customer/non-financial", cacheable.get().options?.gateway?.skipCache === false);
}

/* ── 7. Phase 5b, OpenRouter provider (OpenAI-compatible) ──────────────────── */

async function testOpenRouter(): Promise<void> {
  console.info("Phase 5b (OpenRouter provider):");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let captured: any;
  const ctx: ResolveCtx = {
    runtime: "deno", // OpenRouter is HTTP, reachable on any runtime
    config: DEFAULT_CONFIG,
    transports: {
      openrouter: {
        apiKey: "OR_KEY",
        fetch: async (url, init) => {
          captured = { url, init };
          return {
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({
              model: "x/echo",
              choices: [{ message: { content: "{}" } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }),
          };
        },
      },
    },
    now: () => 0,
    sleep: async () => {},
    timeoutSignal: (ms: number) => ({ __timeoutMs: ms }),
  };
  await resolve(
    {
      useCase: USE_CASE.EMAIL_COMPOSE,
      tenantId: TENANT_EXAMPLE,
      system: "S",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 50,
      jsonObject: true,
      pinModel: { provider: "openrouter", model: "meta-llama/llama-3.2-3b-instruct" },
    },
    ctx,
  );
  const body = JSON.parse(captured.init.body);
  expect("url is openrouter chat/completions", captured.url === "https://openrouter.ai/api/v1/chat/completions");
  expect("Authorization bearer", captured.init.headers["Authorization"] === "Bearer OR_KEY");
  expect("model passed through", body.model === "meta-llama/llama-3.2-3b-instruct");
  expect("system folded into messages[0]", body.messages[0].role === "system" && body.messages[1].role === "user");
  expect("json_object response_format", body.response_format?.type === "json_object");
}

/* ── run ──────────────────────────────────────────────────────────────────── */

await testChat();
await testSynthesize();
await testCompose();
await testInsightsFallback();
await testInvariants();
await testPhase4();
await testOpenRouter();

if (failures > 0) {
  console.error(`\n✗ parity: ${failures} check(s) failed, answers may have changed.`);
  process.exit(1);
}
console.info("\n✓ parity: every routed call site builds an identical provider request, answers unchanged.");
