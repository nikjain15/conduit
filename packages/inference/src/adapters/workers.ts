/**
 * Cloudflare Workers adapter for @conduit/inference.
 *
 * Builds a ResolveCtx from the Worker's Env + ExecutionContext: Anthropic over
 * HTTP (gateway-routed when configured) AND the Workers-AI binding, with the
 * decision-log write registered on ctx.waitUntil so it never blocks the response
 * and log-drops gracefully if Supabase is unreachable (D18).
 *
 * Type-checked by the Worker's own tsconfig (it has @cloudflare/workers-types),
 * not by the package's pure-only tsconfig, this file references Worker globals
 * (fetch, AbortSignal, setTimeout, console, ExecutionContext).
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
} from "../core";
import {
  judge,
  toEvalDefs,
  applyOutcome,
  judgeInputFrom,
  DEFAULT_ROSTER,
  type EvalDef,
  type JudgeCtx,
  type JudgeInput,
  type JudgeOutcome,
  type SourceReconcile,
  type UseCaseEvalRow,
} from "../judge";

export { judgeInputFrom };

/** The subset of the Worker Env @conduit/inference needs (structurally compatible
 *  with site-bubble/worker's Env). */
export interface WorkersInferenceEnv {
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  /** The Workers-AI binding. Typed loosely so the Worker's strongly-typed `Ai`
   *  binding (whose run() is overloaded on a model-name union) assigns cleanly;
   *  we always call it with a routed model string. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: { run: (...args: any[]) => Promise<unknown> };
  /** Cloudflare AI Gateway (D11), set both to route through the gateway; unset =
   *  call providers directly (byte-identical to today). */
  AI_GATEWAY_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** OpenRouter key (Phase 5b), set as a Worker secret; unset = OpenRouter models
   *  aren't routable (resolve() throws config_error if one is routed without it). */
  OPENROUTER_API_KEY?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export function makeWorkersCtx(
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  config: InferenceConfig = DEFAULT_CONFIG,
): ResolveCtx {
  const gateway: GatewayConfig | undefined =
    env.AI_GATEWAY_ACCOUNT_ID && env.AI_GATEWAY_ID
      ? { accountId: env.AI_GATEWAY_ACCOUNT_ID, gatewayId: env.AI_GATEWAY_ID }
      : undefined;

  const recordSink = (record: AiDecisionRecord) => {
    const { url, init } = buildRecordRequest(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, record);
    exec.waitUntil(
      fetch(url, init)
        .then(async (res) => {
          if (!res.ok && res.status !== 409) {
            console.error(`ai_decisions log-drop (${res.status}): ${(await res.text()).slice(0, 200)}`);
          }
        })
        .catch((e) => console.error("ai_decisions log-drop:", e instanceof Error ? e.message : e)),
    );
  };

  return {
    runtime: "workers",
    config,
    transports: {
      // Bind fetch to globalThis, calling the bare global as `transport.fetch(...)`
      // rebinds `this` and throws "Illegal invocation" on Workers.
      anthropic: { apiKey: env.ANTHROPIC_API_KEY, fetch: fetch.bind(globalThis) as unknown as FetchLike },
      workersAi: { run: (m, i, o) => env.AI.run(m, i, o) },
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

export async function resolveOnWorkers(
  task: ResolveTask,
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  config?: InferenceConfig,
): Promise<ResolveResult> {
  return resolve(task, makeWorkersCtx(env, exec, config ?? (await loadInferenceConfig(env))));
}

/* ── Phase 2: judging on Workers ───────────────────────────────────────────── */

/** Eval config cache (per isolate, ~60s), mirrors the persona/prompt caches in
 *  the Worker. Config is global (no customer data), so caching is safe. */
const CONFIG_TTL_MS = 60_000;
const _evalConfigCache = new Map<string, { at: number; defs: EvalDef[] }>();

/** Model/routing config cache (per isolate, ~60s). Loaded from the service-role
 *  twin ai_runtime_inference_config (Phase 4, D10): routing, prices, per-use-case
 *  meta (backup/cap/cache). On any error, falls back to the last good cache or the
 *  seed DEFAULT_CONFIG, never throws into the answer path (D18). */
let _inferenceConfigCache: { at: number; config: InferenceConfig } | null = null;

export async function loadInferenceConfig(env: WorkersInferenceEnv): Promise<InferenceConfig> {
  if (_inferenceConfigCache && Date.now() - _inferenceConfigCache.at < CONFIG_TTL_MS) {
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
      console.error(`loadInferenceConfig ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return _inferenceConfigCache?.config ?? DEFAULT_CONFIG;
    }
    const config = buildInferenceConfig((await res.json()) as TwinPayload);
    _inferenceConfigCache = { at: Date.now(), config };
    return config;
  } catch (e) {
    console.error("loadInferenceConfig error:", e instanceof Error ? e.message : e);
    return _inferenceConfigCache?.config ?? DEFAULT_CONFIG;
  }
}

/** Load the resolved eval config for a use case via the service-role runtime RPC
 *  (ai_runtime_usecase_evals). On any error, falls back to the last good cache or
 *  an empty set, never throws into the answer path (D18). */
export async function loadEvalDefs(env: WorkersInferenceEnv, useCase: string): Promise<EvalDef[]> {
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
      console.error(`loadEvalDefs(${useCase}) ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return hit?.defs ?? [];
    }
    const rows = (await res.json()) as UseCaseEvalRow[];
    const defs = toEvalDefs(rows);
    _evalConfigCache.set(useCase, { at: Date.now(), defs });
    return defs;
  } catch (e) {
    console.error("loadEvalDefs error:", e instanceof Error ? e.message : e);
    return hit?.defs ?? [];
  }
}

export interface WorkersJudgeOpts {
  mode: "inline" | "async";
  phase?: "gates" | "scores" | "all";
  /** Per-judge-call timeout. */
  callTimeoutMs?: number;
  /** Skip LLM evals this pass (deterministic only), used for the inline chat
   *  gate so it stays within budget; the panel re-judges async. */
  llmDisabled?: boolean;
  reconcile?: SourceReconcile;
}

export function makeWorkersJudgeCtx(
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  opts: WorkersJudgeOpts,
): JudgeCtx {
  return {
    resolveCtx: makeWorkersCtx(env, exec),
    prices: DEFAULT_PRICES,
    now: () => Date.now(),
    random: () => Math.random(),
    roster: DEFAULT_ROSTER,
    mode: opts.mode,
    phase: opts.phase ?? "all",
    callTimeoutMs: opts.callTimeoutMs ?? (opts.mode === "inline" ? 2_000 : undefined),
    llmDisabled: opts.llmDisabled,
    reconcile: opts.reconcile,
  };
}

/** Write a complete (judged) decision row, awaiting the fetch. Call inside a
 *  waitUntil scope. Log-drops on failure (D18). */
export async function writeDecisionRecord(env: WorkersInferenceEnv, record: AiDecisionRecord): Promise<void> {
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

/** Resolve WITHOUT writing the log, the deferred path. The caller (live chat)
 *  judges the answer, then writes one enriched row via finalizeChatDecision. */
export async function resolveDeferredOnWorkers(
  task: ResolveTask,
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  config?: InferenceConfig,
): Promise<ResolveResult> {
  return resolve(
    { ...task, record: { ...task.record, defer: true } },
    makeWorkersCtx(env, exec, config ?? (await loadInferenceConfig(env))),
  );
}

const failClosedOutcome = (budgetMs: number): JudgeOutcome => ({
  evals: {},
  gateStatus: "failed_closed",
  judgeCostUsd: 0,
  judgeLatencyMs: budgetMs,
});

/**
 * Live-chat inline GATE pass (Option B, D3). Runs the DETERMINISTIC floor only ,
 * safety prefilter + privacy + valid-format, which block hard-unsafe / PII /
 * malformed answers instantly (no model call, so well within the <500ms budget).
 * The LLM panel (classifier + multi-model judges) runs ASYNC in finalizeChat
 * Decision, real Workers-AI latency (~0.5–2s) can't fit an inline live-chat
 * budget, and a marketing chat can't wait on it. A deterministic gate fail still
 * FAILS CLOSED to a human handoff; the async panel's verdict updates gate_status
 * so blocked/escalated answers surface in the review queue (Phase 3).
 *
 * The budget is a crash-safety net only (deterministic checks finish in ~1ms).
 */
export async function judgeChatGatesInline(
  input: JudgeInput,
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  budgetMs = 400,
): Promise<JudgeOutcome> {
  if (input.evals.filter((e) => e.kind === "gate" && e.enabled).length === 0) {
    return { evals: {}, gateStatus: "passed", judgeCostUsd: 0, judgeLatencyMs: 0 };
  }
  // llmDisabled → only the deterministic floor runs inline; LLM gates are recorded
  // deferred and re-judged by the async panel below.
  const jctx = makeWorkersJudgeCtx(env, exec, { mode: "inline", phase: "gates", llmDisabled: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<JudgeOutcome>((res) => {
    timer = setTimeout(() => res(failClosedOutcome(budgetMs)), budgetMs);
  });
  try {
    return await Promise.race([judge(input, jctx), budget]);
  } catch {
    return failClosedOutcome(budgetMs);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Whether an inline gate status means the live answer must not ship as-is. For
 *  live chat, blocked / failed_closed / escalated all route to a human-handoff
 *  (a customer chat can't wait for async review, D3). */
export function chatNeedsHandoff(status: JudgeOutcome["gateStatus"]): boolean {
  return status === "blocked" || status === "failed_closed" || status === "escalated";
}

/**
 * Finalize a chat decision: merge the inline deterministic outcome, then run the
 * FULL panel async (mode "async", phase "all", LLM gate evals via the multi-model
 * panel + sampled score evals), and write ONE enriched row on waitUntil. The
 * answer already shipped, so the async panel can't block it, but its verdict sets
 * gate_status, so a blocked/escalated answer surfaces in the review queue and
 * feeds the autonomy ramp. Nothing here blocks the response.
 */
export function finalizeChatDecision(
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  base: AiDecisionRecord,
  input: JudgeInput,
  gateOutcome: JudgeOutcome,
): void {
  exec.waitUntil(
    (async () => {
      let merged = applyOutcome(base, gateOutcome, new Date().toISOString());
      try {
        const panelOutcome = await judge(
          input,
          makeWorkersJudgeCtx(env, exec, { mode: "async", phase: "all" }),
        );
        merged = applyOutcome(merged, panelOutcome, new Date().toISOString());
      } catch (e) {
        console.error("chat async panel:", e instanceof Error ? e.message : e);
      }
      await writeDecisionRecord(env, merged);
    })(),
  );
}

/**
 * Resolve an answer AND judge it (async batch grading), writing ONE enriched row.
 * For non-live use cases (email drafts, insights), no live-latency budget, so the
 * full panel runs. The answer is returned immediately; judging + the single write
 * happen on waitUntil so nothing blocks the caller (D18). Answers are unchanged.
 */
export async function resolveAndJudgeOnWorkers(
  task: ResolveTask,
  env: WorkersInferenceEnv,
  exec: ExecutionContextLike,
  opts?: { reconcile?: SourceReconcile; context?: { sourceIds?: string[] } | null },
): Promise<ResolveResult> {
  const id = crypto.randomUUID();
  const result = await resolve(
    { ...task, record: { ...task.record, id, defer: true } },
    makeWorkersCtx(env, exec, await loadInferenceConfig(env)),
  );
  const base = result.record;
  if (!base) return result; // no record built (shouldn't happen on defer), ship answer

  exec.waitUntil(
    (async () => {
      try {
        const defs = await loadEvalDefs(env, task.useCase);
        if (defs.length === 0) {
          await writeDecisionRecord(env, base); // still log the decision
          return;
        }
        const answerJson = base.output_json ?? undefined;
        const input = judgeInputFrom(task, result.model, result.text, answerJson, defs, opts?.context);
        const outcome = await judge(input, makeWorkersJudgeCtx(env, exec, { mode: "async", phase: "all", reconcile: opts?.reconcile }));
        await writeDecisionRecord(env, applyOutcome(base, outcome, new Date().toISOString()));
      } catch (e) {
        console.error("resolveAndJudge log-drop:", e instanceof Error ? e.message : e);
        await writeDecisionRecord(env, base); // never lose the decision row
      }
    })(),
  );
  return result;
}
