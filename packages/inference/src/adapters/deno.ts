/**
 * Supabase Edge (Deno) adapter for @conduit/inference.
 *
 * HTTP only, there is NO Workers-AI binding on Supabase Edge, so this ctx
 * provides only the Anthropic transport. The routing guard in core.ts will throw
 * if a @cf/* model is ever routed here (defense in depth). The decision-log write
 * is registered on EdgeRuntime.waitUntil when available, else fire-and-forget;
 * either way it log-drops gracefully and never blocks the response (D18).
 *
 * Imports core with an explicit ".ts" extension (Deno requires it). Type-checked
 * by Deno at runtime, not by the package's pure-only tsconfig.
 *
 * DEPLOY: edge functions do NOT import this file across the repo root. It is
 * vendored into supabase/functions/_shared/inference/ by `pnpm vendor:inference`
 * (the vendored copy rewrites "../core.ts" -> "./core.ts"), so Supabase bundles
 * it from within supabase/functions/. This file remains the single source of
 * truth; `pnpm check:vendor` fails CI if the vendored copy drifts.
 */
import {
  resolve,
  buildRecordRequest,
  buildInferenceConfig,
  DEFAULT_CONFIG,
  DEFAULT_PRICES,
  type AiDecisionRecord,
  type FetchLike,
  type GatewayConfig,
  type InferenceConfig,
  type ResolveCtx,
  type ResolveResult,
  type ResolveTask,
  type TwinPayload,
} from "../core.ts";
import {
  judge,
  toEvalDefs,
  applyOutcome,
  judgeInputFrom,
  DEFAULT_ROSTER,
  type EvalDef,
  type JudgeCtx,
  type SourceReconcile,
  type UseCaseEvalRow,
} from "../judge.ts";

export interface DenoInferenceEnv {
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** OpenRouter key (Phase 5b), set as a Supabase secret to make OpenRouter
   *  models routable from the edge fn; unset = not routable here. */
  OPENROUTER_API_KEY?: string;
}

export function makeDenoCtx(
  env: DenoInferenceEnv,
  config: InferenceConfig = DEFAULT_CONFIG,
): ResolveCtx {
  const gateway: GatewayConfig | undefined =
    env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID
      ? { accountId: env.AI_GATEWAY_ACCOUNT_ID, gatewayId: env.AI_GATEWAY_ID }
      : undefined;

  const recordSink = (record: AiDecisionRecord) => {
    const { url, init } = buildRecordRequest(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, record);
    const p = fetch(url, init)
      .then(async (res) => {
        if (!res.ok && res.status !== 409) {
          console.error(`ai_decisions log-drop (${res.status}): ${(await res.text()).slice(0, 200)}`);
        }
      })
      .catch((e) => console.error("ai_decisions log-drop:", e instanceof Error ? e.message : e));
    // Supabase Edge keeps the isolate alive for waitUntil'd work after the
    // response; fall back to fire-and-forget if the global isn't present.
    const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") er.waitUntil(p);
  };

  return {
    runtime: "deno",
    config,
    transports: {
      // Bind fetch to globalThis, calling the bare global as `transport.fetch(...)`
      // rebinds `this` and throws "Illegal invocation".
      anthropic: { apiKey: env.ANTHROPIC_API_KEY, fetch: fetch.bind(globalThis) as unknown as FetchLike },
      openrouter: env.OPENROUTER_API_KEY
        ? { apiKey: env.OPENROUTER_API_KEY, fetch: fetch.bind(globalThis) as unknown as FetchLike }
        : undefined,
    },
    gateway,
    recordSink,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    timeoutSignal: (ms: number) => AbortSignal.timeout(ms),
  };
}

/** Model/routing config cache (~60s) from the service-role twin (Phase 4, D10).
 *  Falls back to last good cache or DEFAULT_CONFIG, never throws (D18). */
let _inferenceConfigCache: { at: number; config: InferenceConfig } | null = null;

export async function loadInferenceConfigDeno(env: DenoInferenceEnv): Promise<InferenceConfig> {
  if (_inferenceConfigCache && Date.now() - _inferenceConfigCache.at < 60_000) {
    return _inferenceConfigCache.config;
  }
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_runtime_inference_config`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      console.error(`loadInferenceConfigDeno ${res.status}`);
      return _inferenceConfigCache?.config ?? DEFAULT_CONFIG;
    }
    const config = buildInferenceConfig((await res.json()) as TwinPayload);
    _inferenceConfigCache = { at: Date.now(), config };
    return config;
  } catch (e) {
    console.error("loadInferenceConfigDeno error:", e instanceof Error ? e.message : e);
    return _inferenceConfigCache?.config ?? DEFAULT_CONFIG;
  }
}

export async function resolveOnDeno(
  task: ResolveTask,
  env: DenoInferenceEnv,
  config?: InferenceConfig,
): Promise<ResolveResult> {
  return resolve(task, makeDenoCtx(env, config ?? (await loadInferenceConfigDeno(env))));
}

/* ── Phase 2: judging on Supabase Edge (Deno) ──────────────────────────────── */
//
// Deno has NO Workers-AI binding, and an Anthropic judge can't grade an Anthropic
// generator (D20). So the LLM panel is DEFERRED here (llmDisabled), only the
// deterministic floor + SQL-reconcile gates run, which need no model. Insights
// (Anthropic-generated) still gets its valid_format gate + a recorded decision;
// its grounded LLM gate is deferred to a Worker-side batch (a later phase) rather
// than fabricating a same-family judge or adding a Cloudflare API-token secret.

const CONFIG_TTL_MS = 60_000;
const _evalConfigCache = new Map<string, { at: number; defs: EvalDef[] }>();

export async function loadEvalDefsDeno(env: DenoInferenceEnv, useCase: string): Promise<EvalDef[]> {
  const hit = _evalConfigCache.get(useCase);
  if (hit && Date.now() - hit.at < CONFIG_TTL_MS) return hit.defs;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/ai_runtime_usecase_evals`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_use_case: useCase }),
    });
    if (!res.ok) {
      console.error(`loadEvalDefsDeno(${useCase}) ${res.status}`);
      return hit?.defs ?? [];
    }
    const rows = (await res.json()) as UseCaseEvalRow[];
    const defs = toEvalDefs(rows);
    _evalConfigCache.set(useCase, { at: Date.now(), defs });
    return defs;
  } catch (e) {
    console.error("loadEvalDefsDeno error:", e instanceof Error ? e.message : e);
    return hit?.defs ?? [];
  }
}

async function writeDecisionRecordDeno(env: DenoInferenceEnv, record: AiDecisionRecord): Promise<void> {
  try {
    const { url, init } = buildRecordRequest(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, record);
    const res = await fetch(url, init);
    if (!res.ok && res.status !== 409) {
      console.error(`ai_decisions write (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
  } catch (e) {
    console.error("ai_decisions write log-drop:", e instanceof Error ? e.message : e);
  }
}

function makeDenoJudgeCtx(env: DenoInferenceEnv, reconcile?: SourceReconcile): JudgeCtx {
  return {
    resolveCtx: makeDenoCtx(env),
    prices: DEFAULT_PRICES,
    now: () => Date.now(),
    random: () => Math.random(),
    roster: DEFAULT_ROSTER,
    mode: "async",
    phase: "all",
    llmDisabled: true, // no Workers-AI binding on Edge; same-family Anthropic judge barred (D20)
    reconcile,
  };
}

/**
 * Resolve an answer AND judge it (deterministic gates only on Deno), writing ONE
 * enriched row. The answer is returned immediately; judging + the single write run
 * on EdgeRuntime.waitUntil when available, else awaited fire-and-forget (D18).
 */
export async function resolveAndJudgeOnDeno(
  task: ResolveTask,
  env: DenoInferenceEnv,
  opts?: { reconcile?: SourceReconcile; context?: { sourceIds?: string[] } | null },
): Promise<ResolveResult> {
  const id = crypto.randomUUID();
  const result = await resolve(
    { ...task, record: { ...task.record, id, defer: true } },
    makeDenoCtx(env, await loadInferenceConfigDeno(env)),
  );
  const base = result.record;
  if (!base) return result;

  const work = (async () => {
    try {
      const defs = await loadEvalDefsDeno(env, task.useCase);
      if (defs.length === 0) {
        await writeDecisionRecordDeno(env, base);
        return;
      }
      const input = judgeInputFrom(task, result.model, result.text, base.output_json ?? undefined, defs, opts?.context);
      const outcome = await judge(input, makeDenoJudgeCtx(env, opts?.reconcile));
      await writeDecisionRecordDeno(env, applyOutcome(base, outcome, new Date().toISOString()));
    } catch (e) {
      console.error("resolveAndJudgeOnDeno log-drop:", e instanceof Error ? e.message : e);
      await writeDecisionRecordDeno(env, base);
    }
  })();

  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work);
  else void work;
  return result;
}
