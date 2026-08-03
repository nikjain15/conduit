/**
 * @conduit/inference, the AI quality & cost layer's pure core.
 *
 * Every AI request passes through `resolve(task, ctx)`. This file is the
 * single, runtime-agnostic "front desk": it picks the model, calls the provider,
 * times + prices the call, builds one `ai_decisions` record, and returns the raw
 * answer unchanged. It depends on NO runtime globals, `fetch`, `setTimeout`,
 * `AbortSignal`, `Date.now`, the Workers-AI binding, and the record sink are all
 * injected via `ctx` (see ResolveCtx). That's what lets the same logic run inside
 * a Cloudflare Worker, a Supabase Edge (Deno) function, and Node (the CI test).
 *
 * Design rules encoded here (see docs/plans/ai-quality-cost-layer-plan.html):
 *   D14  pure core + per-runtime adapters, the seam, not a config flip.
 *   D10  config-driven: routing + price tables are data, never per-file constants.
 *   D11  Cloudflare AI Gateway is the front door when configured; cache stays OFF
 *        in Phase 0 so answers are byte-identical and never cross tenants.
 *   D15  tenant_id is a non-empty invariant on every record (asserted here).
 *   D18  logging is async + crash-safe: recordSink is fire-and-forget; a failed
 *        write never throws and never blocks the answer.
 *   §arch the routing table refuses a @cf/* (Workers-AI) model on Deno/Node.
 *
 * Phase 0 keeps answers UNCHANGED: callers pass `pinModel` (their current model)
 * so routing is a faithful pass-through, and they keep their own parsing of the
 * raw text/object. Nothing here interprets the answer.
 *
 * NOTE: this file was written self-contained (no internal imports) so it could be
 * consumed by esbuild (Worker), Deno (edge fn), and Vite/tsx (admin/CI) without
 * import-extension conflicts. It now has exactly ONE internal import, the
 * guardrails engine, added deliberately and recorded here rather than left as a
 * surprise. The reason is in docs/adr/ADR-0001: a floor a caller has to remember
 * to wire is an opt in, and the default is then no protection. resolve() is the
 * one path every request already takes, so the floor lives here. The import is
 * written with an explicit .ts extension so Deno resolves it.
 */
import {
  runGuardrails,
  type GuardrailAction,
  type GuardrailReason,
} from "../../guardrails/src/index.ts";
import type { GuardrailsConfig } from "../../profile/src/types.ts";

/* ── Identity & config types ──────────────────────────────────────────────── */

export type Provider = "anthropic" | "workers-ai" | "openrouter";
export type Runtime = "workers" | "deno" | "node";

/** Gate decision recorded on ai_decisions.gate_status. "unevaluated" = Phase-0
 *  pass-through (no judge ran). The judge (judge.ts) sets the rest. Defined here
 *  (not judge.ts) so the record type can reference it without a circular import. */
export type GateStatus = "unevaluated" | "passed" | "blocked" | "escalated" | "failed_closed";

export interface ModelRef {
  provider: Provider;
  /** e.g. "claude-haiku-4-5-20251001" or "@cf/meta/llama-3.3-70b-instruct-fp8-fast" */
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Per-million-token prices (USD). Workers-AI free tier = 0 but we still record usage. */
export interface PriceEntry {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Per-use-case control config (Phase 4, D10/D11). Loaded from ai_model_config
 *  via the service-role twin and cached by the adapter (~60s). All optional so a
 *  config without `meta` behaves exactly as Phase 0–2 (backward compatible). */
export interface UseCaseMeta {
  main: ModelRef;
  /** Cheaper fallback used when month-to-date spend hits the cap (D11). */
  backup?: ModelRef;
  /** Monthly spend cap (USD). null/undefined = no cap. */
  capUsd?: number;
  /** Month-to-date spend (USD) supplied by the runtime twin for cap comparison. */
  spentUsd?: number;
  /** Admin caching toggle, only ever honored for non-customer-facing,
   *  non-financial use cases (the exact-match gateway cache is global; D11/D15). */
  cacheEnabled?: boolean;
  customerFacing?: boolean;
  financial?: boolean;
}

export interface InferenceConfig {
  /** use case -> the model it routes to. Phase 0 prefers task.pinModel; populated
   *  from the DB by the admin (Phase 4, D10). Kept as the simple main-model map so
   *  existing callers/tests that read `config.routing` are unaffected. */
  routing: Record<string, ModelRef>;
  /** model id -> price. Editable config (D10/D22); seed values, verify in admin. */
  prices: Record<string, PriceEntry>;
  /** Per-use-case control config (backup, cap, cache). Absent = Phase 0–2 behavior. */
  meta?: Record<string, UseCaseMeta>;
}

/* ── The ask / the answer ─────────────────────────────────────────────────── */

export interface ResolveTask {
  /** Stable id; keys the routing table + the ai_decisions record. */
  useCase: string;
  /** D15 isolation key. Namespaced: "org:example" | "anon:<sessionId>" |
   *  "org:<uuid>". Asserted non-empty, a missing tenant is a hard error. */
  tenantId: string;
  /** System prompt (provider-native placement handled per provider). */
  system?: string;
  /** Conversation turns the caller wants sent, verbatim. */
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Anthropic structured-output contract -> output_config.json_schema. */
  jsonSchema?: Record<string, unknown>;
  /** Workers-AI structured-output -> response_format json_object. */
  jsonObject?: boolean;
  /** Anthropic-specific knobs preserved verbatim for byte-identical Phase 0. */
  anthropic?: {
    /** anthropic-beta header values, e.g. ["prompt-caching-2024-07-31"]. */
    betas?: string[];
    /** Wrap the system block with cache_control: ephemeral (chat does today). */
    cacheSystem?: boolean;
    /** 429 backoff retries (chat=2). 0 = no retry (insights throws -> fallback). */
    maxRetries?: number;
    /** Base backoff ms (chat=8000 -> 8s,16s). */
    retryBaseMs?: number;
  };
  /** Hard request timeout in ms (insights uses 60000). */
  timeoutMs?: number;
  /** Phase-0 escape hatch: force the exact current model, bypassing routing, so
   *  answers are provably unchanged. Relaxed once admin routing lands (Phase 4). */
  pinModel?: ModelRef;
  /**
   * The use case profile's guardrails config. When present, resolve() screens the
   * request through the guardrails engine: injection before the model call, PII,
   * output schema, HITL confidence, and mandatory floors after it.
   *
   * OPTIONAL BY DESIGN, AND THAT IS THE COMPROMISE. A profile without this field
   * behaves exactly as it did before the floor was wired, which is what lets the
   * floor land without breaking a single existing caller. It also means the floor
   * is only as universal as the profiles that carry the config, so "screened" is
   * a property of a use case, not yet of the system. Making it non-optional is a
   * separate, breaking change; see docs/adr/ADR-0001.
   */
  guardrails?: GuardrailsConfig;
  /** Extra context the post-call guardrails read. `confidence` feeds the HITL
   *  threshold; `presentEvalKeys` names the evals that actually ran, which is what
   *  the mandatory floors are checked against. */
  guardrailContext?: {
    confidence?: number;
    presentEvalKeys?: string[];
  };
  /** Record controls + correlation. */
  record?: {
    /** Client-generated decision id. Lets the judged path build the record, grade
     *  it, and write ONE enriched row by a known id (no insert→update race). */
    id?: string;
    /** Defer the log write: resolve() builds the record and returns it on
     *  ResolveResult.record instead of firing recordSink. The caller (the judged
     *  path) enriches it with eval results and writes it once. Default false =
     *  Phase-0 auto-write behavior, unchanged. */
    defer?: boolean;
    /** session id / run id stored as request_ref for correlation. */
    ref?: string | null;
    /** PII minimization: when false, `input` is stored null (D11). Default true. */
    storeInput?: boolean;
    /** Dual-write reconcile link to the legacy row this decision corresponds to. */
    legacyTable?: string | null;
    legacyId?: string | null;
  };
}

/**
 * What resolve() decided to do with the answer. Self-describing on purpose: a
 * guardrail refusal returns a ResolveResult carrying this, never an exception,
 * because a caller catching an opaque Error cannot tell a refusal from a 500 and
 * will retry the one it should not.
 *
 *  - "served"          normal answer, nothing intervened.
 *  - "served_redacted" answer served with PII masked; `text` is the masked text.
 *  - "blocked"         answer withheld. `text` is empty. `guardrail` says why.
 *  - "escalated"       answer withheld pending a human. `text` is empty and the
 *                      unserved answer, if the model produced one, is on
 *                      `guardrail.withheldAnswer`.
 */
export type ResolveStatus = "served" | "served_redacted" | "blocked" | "escalated";

/** The guardrail verdict attached to a resolve() result. Present only when the
 *  task carried a guardrails config. */
export interface GuardrailOutcome {
  /** "input" ran before the model call, "output" after it. A blocked input means
   *  no model call was made and no tokens were spent. */
  phase: "input" | "output";
  action: GuardrailAction;
  reasons: GuardrailReason[];
  /** True when a refusal was routed to human review rather than refused. */
  routedToReview?: boolean;
  /** The answer that was NOT served, present on "blocked" and "escalated" from
   *  the output phase. Kept so a reviewer can see what was withheld; a caller
   *  must not serve it. */
  withheldAnswer?: string;
}

export interface ResolveResult {
  /** What happened. Check this before using `text`: on a refusal `text` is "". */
  status: ResolveStatus;
  /** The guardrail verdict, when a guardrails config ran. Absent otherwise. */
  guardrail?: GuardrailOutcome;
  /** Raw model text, the caller parses/guards exactly as it does today. Empty
   *  when `status` is "blocked" or "escalated". */
  text: string;
  /** Provider-native response payload (Workers-AI returns an object the caller
   *  branches on). Undefined for plain Anthropic text. */
  raw?: unknown;
  model: ModelRef;
  /** Model id the provider reported serving (Anthropic echoes it); falls back to
   *  model.model. Use this to keep any recorded "model" string identical. */
  providerModel: string;
  usage: { inputTokens?: number; outputTokens?: number };
  costUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  /** The decision id (client-generated when task.record.id is set, else absent). */
  decisionId?: string;
  /** Present only on the deferred path (task.record.defer): the built record for
   *  the caller to enrich with eval results and write once. */
  record?: AiDecisionRecord;
}

/* ── Injected runtime bindings ────────────────────────────────────────────── */

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: unknown },
) => Promise<HttpResponse>;

export interface AnthropicTransport {
  apiKey: string;
  fetch: FetchLike;
}
export interface WorkersAiTransport {
  /** env.AI.run(model, input, options?) */
  run: (model: string, input: unknown, options?: unknown) => Promise<unknown>;
}
/** OpenRouter, OpenAI-compatible; one key, hundreds of hosted models (Phase 5b).
 *  Reachable on every runtime (HTTP), so no @cf-style runtime guard applies. */
export interface OpenRouterTransport {
  apiKey: string;
  fetch: FetchLike;
}

/** Cloudflare AI Gateway routing (D11). Config-gated, absent = call providers
 *  directly (byte-identical to today). */
export interface GatewayConfig {
  accountId: string;
  gatewayId: string;
}

export interface ResolveCtx {
  runtime: Runtime;
  config: InferenceConfig;
  transports: {
    anthropic?: AnthropicTransport;
    workersAi?: WorkersAiTransport;
    openrouter?: OpenRouterTransport;
  };
  gateway?: GatewayConfig;
  /** Crash-safe, fire-and-forget record write (D18). The adapter wraps this in
   *  ctx.waitUntil / EdgeRuntime.waitUntil and swallows errors. Optional: when
   *  absent, resolve() simply doesn't log (the answer still ships). */
  recordSink?: (record: AiDecisionRecord) => void;
  /** Injected runtime helpers (adapters supply real implementations). */
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Builds an AbortSignal for a timeout; undefined -> no timeout applied. */
  timeoutSignal?: (ms: number) => unknown;
}

/* ── The record (mirrors the ai_decisions table, server-defaulted cols omitted) ─ */

export interface AiDecisionRecord {
  /** Client-generated id (judged path) so eval results land on a known row. */
  id?: string;
  tenant_id: string;
  use_case: string;
  runtime: Runtime;
  provider: Provider;
  model: string;
  request_ref?: string | null;
  input?: unknown;
  output?: string | null;
  output_json?: unknown;
  usage: Record<string, unknown>;
  cost_usd: number | null;
  latency_ms: number | null;
  cache_hit: boolean;
  /** Phase 2 fills evals + gate_status; Phase 0 ships the answer as 'unevaluated'. */
  gate_status: GateStatus;
  /** Per-eval results keyed by eval key (judge.ts EvalResult); set by the judged path. */
  evals?: Record<string, unknown>;
  judge_cost_usd?: number | null;
  judge_latency_ms?: number | null;
  judged_at?: string | null;
  legacy_table?: string | null;
  legacy_id?: string | null;
}

/* ── Default config (seed; admin overrides this from the DB in Phase 4) ──────── */

export const USE_CASE = {
  CHAT: "chat",
  INSIGHTS: "insights",
  EMAIL_COMPOSE: "email_compose",
  CONTENT_DRAFT: "content_draft",
} as const;

export const TENANT_EXAMPLE = "org:example";
export const anonTenant = (sessionId: string): string => `anon:${sessionId}`;
export const orgTenant = (id: string): string => `org:${id}`;

/**
 * Seed price table (USD per million tokens). Cost is config (D10/D22) and does
 * NOT affect answers, these feed the Phase-1 cost KPIs. Verified against the
 * Anthropic price list via the claude-api skill (table cached 2026-06-04):
 * Haiku 4.5 = $1 / $5, Sonnet 4.6 = $3 / $15. Workers-AI models are free-tier
 * -> 0, but token usage is still recorded. Admin model config (Phase 4) will let
 * these be edited live; re-confirm pricing then if it has moved.
 */
export const DEFAULT_PRICES: Record<string, PriceEntry> = {
  "claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-haiku-4-5": { inputPerMTok: 1.0, outputPerMTok: 5.0 },
  "claude-sonnet-4-6": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { inputPerMTok: 0, outputPerMTok: 0 },
};

/**
 * Seed routing (documentation of the current live mapping). Phase 0 callers pass
 * `pinModel` from their own env so behavior is unchanged; this table becomes
 * authoritative once admin model config lands (Phase 4).
 */
export const DEFAULT_ROUTING: Record<string, ModelRef> = {
  [USE_CASE.CHAT]: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  [USE_CASE.INSIGHTS]: { provider: "anthropic", model: "claude-sonnet-4-6" },
  [USE_CASE.EMAIL_COMPOSE]: { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
  [USE_CASE.CONTENT_DRAFT]: { provider: "anthropic", model: "claude-sonnet-4-6" },
};

export const DEFAULT_CONFIG: InferenceConfig = {
  routing: DEFAULT_ROUTING,
  prices: DEFAULT_PRICES,
};

/* ── DB-backed config (Phase 4): build InferenceConfig from the runtime twin ──── */

/** One row of ai_runtime_inference_config().config (the service-role twin). */
export interface TwinConfigRow {
  use_case: string;
  runtime: Runtime;
  customer_facing: boolean;
  financial: boolean;
  main: ModelRef;
  backup: ModelRef | null;
  cache_enabled: boolean;
  monthly_cap_usd: number | null;
  spend_mtd_usd: number;
}
export interface TwinPayload {
  config: TwinConfigRow[];
  prices: Record<string, PriceEntry>;
}

/**
 * Turn the runtime twin payload into an InferenceConfig (Phase 4, D10). DB values
 * are layered OVER the seed defaults so a use case or price missing from the DB
 * still resolves (and an empty/failed payload degrades to DEFAULT_CONFIG). This is
 * the single place the twin shape is interpreted, adapters just fetch + cache it,
 * and it's unit-tested in Node so Workers and Deno stay identical.
 */
export function buildInferenceConfig(payload: Partial<TwinPayload> | null | undefined): InferenceConfig {
  const routing: Record<string, ModelRef> = { ...DEFAULT_ROUTING };
  const meta: Record<string, UseCaseMeta> = {};
  for (const r of payload?.config ?? []) {
    if (!r?.use_case || !r.main?.model) continue;
    routing[r.use_case] = r.main;
    meta[r.use_case] = {
      main: r.main,
      backup: r.backup ?? undefined,
      capUsd: r.monthly_cap_usd ?? undefined,
      spentUsd: r.spend_mtd_usd ?? 0,
      cacheEnabled: !!r.cache_enabled,
      customerFacing: !!r.customer_facing,
      financial: !!r.financial,
    };
  }
  return {
    routing,
    prices: { ...DEFAULT_PRICES, ...(payload?.prices ?? {}) },
    meta,
  };
}

/* ── Cost math ────────────────────────────────────────────────────────────── */

/**
 * Models with no row in the price table are billed at this rate rather than at
 * zero. It is the most expensive tier Conduit currently knows about, on purpose:
 * an unknown model is more likely to be a newly-added frontier tier than a free
 * one, and a cost KPI that reads low is far more dangerous than one that reads
 * high. The `unpriced` flag on the result says which happened, so a caller can
 * tell an estimate from a measurement.
 */
export const UNPRICED_FALLBACK: PriceEntry = { inputPerMTok: 5.0, outputPerMTok: 25.0 };

export interface CostResult {
  usd: number;
  /** True when no price row matched and UNPRICED_FALLBACK was used. */
  unpriced: boolean;
}

/**
 * Price one call.
 *
 * The `if (!p) return 0` this replaces was a silent under-report, and it was
 * reachable: `DEFAULT_PRICES` lists Haiku, Sonnet 4.6 and the free Workers-AI
 * model, while callers may pass any model through `pinModel`, and admin config
 * can rewrite the table at runtime. A call on an unlisted model was recorded as
 * costing nothing at all, so the cost KPIs would read healthy precisely when an
 * expensive unknown tier had been introduced. Zero is the one answer that is
 * never a safe default for a spend figure.
 *
 * Rally's equivalent already got this right and said why ("so an estimate is
 * never silently zero"); its bug was the opposite one, a stale Opus price.
 */
export function computeCostUsd(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
  prices: Record<string, PriceEntry>,
): number {
  return computeCost(model, usage, prices).usd;
}

/** As `computeCostUsd`, but reports whether the price was known. */
export function computeCost(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number },
  prices: Record<string, PriceEntry>,
): CostResult {
  const known = prices[model];
  const p = known ?? UNPRICED_FALLBACK;
  const inTok = usage.inputTokens ?? 0;
  const outTok = usage.outputTokens ?? 0;
  const usd = (inTok / 1_000_000) * p.inputPerMTok + (outTok / 1_000_000) * p.outputPerMTok;
  return { usd, unpriced: !known };
}

/* ── Provider calls (protocol lives in the core; runtime bindings are injected) ─ */

class InferenceError extends Error {
  constructor(
    message: string,
    readonly kind: "rate_limited" | "provider_error" | "config_error" | "transport_error",
  ) {
    super(message);
    this.name = "InferenceError";
  }
}
export { InferenceError };

export interface ProviderOutput {
  text: string;
  raw?: unknown;
  usage: { inputTokens?: number; outputTokens?: number };
  /** The model id the provider reports it actually served (Anthropic echoes it).
   *  Lets callers preserve a recorded "model" field byte-for-byte. */
  providerModel?: string;
}

async function callAnthropic(
  task: ResolveTask,
  model: ModelRef,
  ctx: ResolveCtx,
  cacheAllowed = false,
): Promise<ProviderOutput> {
  const t = ctx.transports.anthropic;
  if (!t) throw new InferenceError("anthropic transport not provided", "config_error");

  const url = ctx.gateway
    ? `https://gateway.ai.cloudflare.com/v1/${ctx.gateway.accountId}/${ctx.gateway.gatewayId}/anthropic/v1/messages`
    : "https://api.anthropic.com/v1/messages";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": t.apiKey,
    "anthropic-version": "2023-06-01",
  };
  const betas = task.anthropic?.betas ?? [];
  if (betas.length) headers["anthropic-beta"] = betas.join(",");
  // D11: through the gateway, skip the (global, non-tenant-keyed) cache unless the
  // use case has been explicitly cleared for caching by resolve(). Default: skip.
  if (ctx.gateway && !cacheAllowed) headers["cf-aig-skip-cache"] = "true";

  const systemField =
    task.system === undefined
      ? undefined
      : task.anthropic?.cacheSystem
        ? [{ type: "text", text: task.system, cache_control: { type: "ephemeral" } }]
        : task.system;

  const body: Record<string, unknown> = {
    model: model.model,
    max_tokens: task.maxTokens,
    messages: task.messages,
  };
  if (systemField !== undefined) body.system = systemField;
  if (task.temperature !== undefined) body.temperature = task.temperature;
  if (task.jsonSchema) {
    body.output_config = { format: { type: "json_schema", schema: task.jsonSchema } };
  }

  const signal =
    task.timeoutMs && ctx.timeoutSignal ? ctx.timeoutSignal(task.timeoutMs) : undefined;

  const maxRetries = task.anthropic?.maxRetries ?? 0;
  const baseMs = task.anthropic?.retryBaseMs ?? 8_000;
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await t.fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (res.status === 429) {
      attempt++;
      if (attempt > maxRetries) throw new InferenceError("rate-limited", "rate_limited");
      await ctx.sleep(baseMs * Math.pow(2, attempt - 1));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new InferenceError(`anthropic ${res.status}: ${errText.slice(0, 300)}`, "provider_error");
    }

    const data = (await res.json()) as {
      model?: string;
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      stop_reason?: string;
    };
    if (data.stop_reason === "refusal") {
      throw new InferenceError("anthropic_refusal", "provider_error");
    }
    const text = data.content?.find((b) => b.type === "text")?.text ?? "";
    return {
      text,
      providerModel: data.model,
      usage: {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
    };
  }
}

async function callWorkersAi(
  task: ResolveTask,
  model: ModelRef,
  ctx: ResolveCtx,
  cacheAllowed = false,
): Promise<ProviderOutput> {
  const t = ctx.transports.workersAi;
  if (!t) throw new InferenceError("workers-ai transport not provided", "config_error");

  const messages = task.system
    ? [{ role: "system", content: task.system }, ...task.messages]
    : task.messages;

  const input: Record<string, unknown> = { messages, max_tokens: task.maxTokens };
  if (task.temperature !== undefined) input.temperature = task.temperature;
  if (task.jsonObject) input.response_format = { type: "json_object" };

  // Gateway routing for the binding is config-gated; cache stays OFF in Phase 0
  // so answers are byte-identical (D11).
  const options = ctx.gateway
    ? { gateway: { id: ctx.gateway.gatewayId, skipCache: !cacheAllowed } }
    : undefined;

  let out: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  try {
    out = (await t.run(model.model, input, options)) as typeof out;
  } catch (e) {
    throw new InferenceError(`workers-ai run failed: ${(e as Error).message}`, "provider_error");
  }
  const resp = out.response;
  const text = typeof resp === "string" ? resp : resp == null ? "" : JSON.stringify(resp);
  return {
    text,
    raw: resp,
    usage: {
      inputTokens: out.usage?.prompt_tokens,
      outputTokens: out.usage?.completion_tokens,
    },
  };
}

async function callOpenRouter(
  task: ResolveTask,
  model: ModelRef,
  ctx: ResolveCtx,
  cacheAllowed = false,
): Promise<ProviderOutput> {
  const t = ctx.transports.openrouter;
  if (!t) throw new InferenceError("openrouter transport not provided", "config_error");

  const url = ctx.gateway
    ? `https://gateway.ai.cloudflare.com/v1/${ctx.gateway.accountId}/${ctx.gateway.gatewayId}/openrouter/v1/chat/completions`
    : "https://openrouter.ai/api/v1/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${t.apiKey}`,
    // OpenRouter attribution headers (optional but recommended).
    "HTTP-Referer": "https://conduit.dev",
    "X-Title": "Conduit",
  };
  if (ctx.gateway && !cacheAllowed) headers["cf-aig-skip-cache"] = "true";

  // OpenAI-compatible: system folds into the messages array.
  const messages = task.system
    ? [{ role: "system", content: task.system }, ...task.messages]
    : task.messages;

  const body: Record<string, unknown> = {
    model: model.model,
    messages,
    max_tokens: task.maxTokens,
  };
  if (task.temperature !== undefined) body.temperature = task.temperature;
  // Use json_object for any structured request, widely supported across OpenRouter
  // models (strict json_schema isn't); callers already re-parse/guard the JSON.
  if (task.jsonSchema || task.jsonObject) body.response_format = { type: "json_object" };

  const signal = task.timeoutMs && ctx.timeoutSignal ? ctx.timeoutSignal(task.timeoutMs) : undefined;
  const maxRetries = task.anthropic?.maxRetries ?? 0;
  const baseMs = task.anthropic?.retryBaseMs ?? 4_000;
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await t.fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal });
    if (res.status === 429) {
      attempt++;
      if (attempt > maxRetries) throw new InferenceError("rate-limited", "rate_limited");
      await ctx.sleep(baseMs * Math.pow(2, attempt - 1));
      continue;
    }
    if (!res.ok) {
      const errText = await res.text();
      throw new InferenceError(`openrouter ${res.status}: ${errText.slice(0, 300)}`, "provider_error");
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? "",
      providerModel: data.model,
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
    };
  }
}

/** Dispatch to the right provider. OpenRouter + Anthropic are HTTP (any runtime);
 *  Workers-AI is guarded to the Workers runtime by the caller. */
function callProvider(
  task: ResolveTask,
  model: ModelRef,
  ctx: ResolveCtx,
  cacheAllowed = false,
): Promise<ProviderOutput> {
  switch (model.provider) {
    case "anthropic":
      return callAnthropic(task, model, ctx, cacheAllowed);
    case "openrouter":
      return callOpenRouter(task, model, ctx, cacheAllowed);
    case "workers-ai":
      return callWorkersAi(task, model, ctx, cacheAllowed);
    default:
      throw new InferenceError(`unknown provider "${model.provider}"`, "config_error");
  }
}

/* ── Record write (shared REST shape; adapters supply fetch) ──────────────── */

/**
 * Build the Supabase REST insert for one decision record. Adapters call this and
 * fire the resulting request through their runtime's fetch, wrapped in
 * waitUntil + a catch (D18). Uses the service-role key + Prefer: return=minimal,
 * matching the Worker's existing supabase.ts insert pattern.
 */
export function buildRecordRequest(
  supabaseUrl: string,
  serviceKey: string,
  record: AiDecisionRecord,
): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  return {
    url: `${supabaseUrl}/rest/v1/ai_decisions`,
    init: {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(record),
    },
  };
}

/* ── rawModelCall(), provider call WITHOUT logging (judge panel reuses this) ── */

/**
 * Call a model and return its raw output, the SAME provider code path resolve()
 * uses, but with no ai_decisions write. The Phase-2 judge panel (judge.ts) calls
 * checker models through this so there is exactly one Anthropic/Workers-AI HTTP
 * implementation in the codebase. Judge calls are meta (they grade an answer);
 * they are NOT themselves logged as decisions, their cost is rolled into the
 * judged answer's `judge_cost_usd` instead. Applies the same off-Workers @cf/*
 * guard as resolve().
 */
export async function rawModelCall(
  ctx: ResolveCtx,
  model: ModelRef,
  opts: {
    system?: string;
    messages: ChatMessage[];
    maxTokens: number;
    temperature?: number;
    jsonObject?: boolean;
    jsonSchema?: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<ProviderOutput> {
  if (model.provider === "workers-ai" && ctx.runtime !== "workers") {
    throw new InferenceError(
      `workers-ai model "${model.model}" not reachable on runtime "${ctx.runtime}"`,
      "config_error",
    );
  }
  const task: ResolveTask = {
    useCase: "_judge",
    tenantId: "_judge",
    system: opts.system,
    messages: opts.messages,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    jsonObject: opts.jsonObject,
    jsonSchema: opts.jsonSchema,
    timeoutMs: opts.timeoutMs,
  };
  return callProvider(task, model, ctx);
}

/* ── The guardrail floor, split across the model call ─────────────────────── */

/**
 * The signals that read the INPUT, so they can run before a token is spent.
 *
 * Only the injection guard reads the input. Splitting the config rather than
 * passing the whole thing matters: `floors` fails closed on a missing eval key,
 * and before the model has answered NO eval has run, so an unsplit pre-call run
 * would refuse every request that declares a floor.
 */
function inputPhaseConfig(g: GuardrailsConfig): GuardrailsConfig {
  return {
    injectionGuard: g.injectionGuard,
    blockedRequestAction: g.blockedRequestAction,
  };
}

/** The signals that read the ANSWER, so they can only run after the model call. */
function outputPhaseConfig(g: GuardrailsConfig): GuardrailsConfig {
  return {
    pii: g.pii,
    piiAction: g.piiAction,
    outputSchema: g.outputSchema,
    hitlThreshold: g.hitlThreshold,
    floors: g.floors,
    blockedRequestAction: g.blockedRequestAction,
  };
}

/** Map a guardrail action onto the record's gate_status column. */
function gateStatusFor(action: GuardrailAction): GateStatus {
  if (action === "block") return "blocked";
  if (action === "escalate") return "escalated";
  return "passed";
}

/* ── resolve(), the one entry point ──────────────────────────────────────── */

export async function resolve(task: ResolveTask, ctx: ResolveCtx): Promise<ResolveResult> {
  // D15: tenant is a hard invariant, enforced in code (never an AI eval).
  if (!task.tenantId || task.tenantId.trim() === "") {
    throw new InferenceError(`tenant_id required for use case "${task.useCase}"`, "config_error");
  }

  const meta = ctx.config.meta?.[task.useCase];
  let model = task.pinModel ?? ctx.config.routing[task.useCase] ?? meta?.main;
  if (!model) {
    throw new InferenceError(`no model routed for use case "${task.useCase}"`, "config_error");
  }
  // D11 spend cap: when month-to-date spend has hit the cap, fall back to the
  // cheaper backup model, a cap is a fallback, never a failure. Pinned callers
  // (the Phase 0–2 byte-identical paths) opt out of the swap.
  let capFallback = false;
  if (!task.pinModel && meta?.capUsd != null && (meta.spentUsd ?? 0) >= meta.capUsd && meta.backup) {
    model = meta.backup;
    capFallback = true;
  }
  // The routing table refuses a @cf/* (Workers-AI) model off the Workers runtime ,
  // Supabase Edge (Deno) and Node can't reach the AI binding. Checked on the
  // effective model (after any cap fallback).
  if (model.provider === "workers-ai" && ctx.runtime !== "workers") {
    throw new InferenceError(
      `workers-ai model "${model.model}" not reachable on runtime "${ctx.runtime}"`,
      "config_error",
    );
  }
  // Caching is only safe for non-customer-facing, non-financial use cases, the
  // exact-match gateway cache is global and not tenant-keyed (D11/D15).
  const cacheAllowed = !!meta?.cacheEnabled && !meta?.customerFacing && !meta?.financial;

  /** Fire the record sink without ever letting a logging failure surface (D18). */
  const emit = (record: AiDecisionRecord): void => {
    if (!ctx.recordSink) return;
    try {
      ctx.recordSink(record);
    } catch {
      /* swallow so a log write never changes what the caller sees. */
    }
  };

  // ── Guardrail floor, input phase. Runs BEFORE the model call, so a refused
  //    request costs nothing and no attacker-controlled text reaches a provider.
  if (task.guardrails) {
    const decision = await runGuardrails(inputPhaseConfig(task.guardrails), {
      // Only the caller's own turns are screened. The system prompt is ours.
      input: task.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n"),
      useCase: task.useCase,
      tenant: task.tenantId,
    });
    if (decision.action === "block" || decision.action === "escalate") {
      const blockedRecord: AiDecisionRecord = {
        id: task.record?.id,
        tenant_id: task.tenantId,
        use_case: task.useCase,
        runtime: ctx.runtime,
        provider: model.provider,
        model: model.model,
        request_ref: task.record?.ref ?? null,
        input: task.record?.storeInput !== false ? { messages: task.messages } : null,
        output: null,
        output_json: null,
        usage: {},
        cost_usd: 0,
        latency_ms: 0,
        cache_hit: false,
        gate_status: gateStatusFor(decision.action),
        // The reasons carry the pattern that fired, so a refusal is auditable and
        // a false block is countable from the decision store, not just in memory.
        evals: { guardrail: { phase: "input", ...decision } },
        legacy_table: task.record?.legacyTable ?? null,
        legacy_id: task.record?.legacyId ?? null,
      };
      if (task.record?.defer !== true) emit(blockedRecord);
      return {
        status: decision.action === "block" ? "blocked" : "escalated",
        guardrail: {
          phase: "input",
          action: decision.action,
          reasons: decision.reasons,
          routedToReview: decision.routedToReview,
        },
        text: "",
        model,
        providerModel: model.model,
        usage: {},
        costUsd: 0,
        latencyMs: 0,
        cacheHit: false,
        decisionId: task.record?.id,
        record: task.record?.defer === true ? blockedRecord : undefined,
      };
    }
  }

  const started = ctx.now();
  let out: ProviderOutput;
  try {
    out = await callProvider(task, model, ctx, cacheAllowed);
  } catch (err) {
    // We do not log failed generations here in Phase 0 (callers keep their own
    // error handling + fallbacks unchanged). Re-throw so behavior is identical.
    throw err;
  }
  const latencyMs = ctx.now() - started;
  const costUsd = computeCostUsd(model.model, out.usage, ctx.config.prices);

  // ── Guardrail floor, output phase. PII, output schema, the HITL confidence
  //    threshold, and the mandatory floors all read the ANSWER, so they can only
  //    run here. A refusal at this point has already cost the tokens; that is the
  //    price of checking output, and it is why the input screen runs first.
  let served = out.text;
  let guardrail: GuardrailOutcome | undefined;
  if (task.guardrails) {
    const decision = await runGuardrails(outputPhaseConfig(task.guardrails), {
      answer: out.text,
      confidence: task.guardrailContext?.confidence,
      presentEvalKeys: task.guardrailContext?.presentEvalKeys,
      useCase: task.useCase,
      tenant: task.tenantId,
    });
    const withheld = decision.action === "block" || decision.action === "escalate";
    guardrail = {
      phase: "output",
      action: decision.action,
      reasons: decision.reasons,
      routedToReview: decision.routedToReview,
      withheldAnswer: withheld ? out.text : undefined,
    };
    if (withheld) served = "";
    else if (decision.action === "redact" && decision.redactedAnswer !== undefined) {
      served = decision.redactedAnswer;
    }
  }
  const status: ResolveStatus = !guardrail
    ? "served"
    : guardrail.action === "block"
      ? "blocked"
      : guardrail.action === "escalate"
        ? "escalated"
        : guardrail.action === "redact"
          ? "served_redacted"
          : "served";

  // Build the record once. On the default path we fire it off the hot path (D18);
  // on the deferred path (task.record.defer) we return it for the judged path to
  // enrich and write exactly once (no insert→update race).
  const storeInput = task.record?.storeInput !== false;
  const record: AiDecisionRecord = {
    id: task.record?.id,
    tenant_id: task.tenantId,
    use_case: task.useCase,
    runtime: ctx.runtime,
    provider: model.provider,
    model: model.model,
    request_ref: task.record?.ref ?? null,
    input: storeInput ? { messages: task.messages } : null,
    // The record stores what the model produced, including an answer that was
    // withheld from the caller: the store is the audit trail, and an incident
    // review needs the text that triggered the refusal.
    output: out.text,
    output_json: out.raw && typeof out.raw === "object" ? out.raw : null,
    usage: capFallback ? { ...out.usage, cap_fallback: true } : out.usage,
    cost_usd: costUsd,
    latency_ms: latencyMs,
    cache_hit: false,
    // "unevaluated" still means exactly what it meant: no gate ran. It is only
    // replaced when a guardrails config actually ran on this request.
    gate_status: guardrail ? gateStatusFor(guardrail.action) : "unevaluated",
    ...(guardrail ? { evals: { guardrail } } : {}),
    legacy_table: task.record?.legacyTable ?? null,
    legacy_id: task.record?.legacyId ?? null,
  };

  const deferred = task.record?.defer === true;
  if (!deferred) emit(record);

  return {
    status,
    guardrail,
    text: served,
    raw: out.raw,
    model,
    providerModel: out.providerModel ?? model.model,
    usage: out.usage,
    costUsd,
    latencyMs,
    cacheHit: false,
    decisionId: task.record?.id,
    record: deferred ? record : undefined,
  };
}
