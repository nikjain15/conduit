/**
 * Node adapter for @conduit/inference, used by the CI parity test and any future
 * Node call site. Defaults to the global fetch (Node 18+); transports, config,
 * gateway, and the record sink are all overridable so tests can inject mocks.
 *
 * Type-checked by tsx/esbuild at run time, not by the package's pure-only
 * tsconfig (references Node globals: fetch, setTimeout, AbortSignal, Date.now).
 */
import {
  resolve,
  buildRecordRequest,
  DEFAULT_CONFIG,
  type AiDecisionRecord,
  type FetchLike,
  type InferenceConfig,
  type ResolveCtx,
  type ResolveResult,
  type ResolveTask,
  type WorkersAiTransport,
} from "../core";

export interface NodeCtxOptions {
  anthropicApiKey?: string;
  supabaseUrl?: string;
  supabaseServiceKey?: string;
  /** Usually a mock in tests; absent on Node real calls (no AI binding). */
  workersAi?: WorkersAiTransport;
  config?: InferenceConfig;
  /** Override the record write; default does a REST insert if supabase* set. */
  recordSink?: (record: AiDecisionRecord) => void;
  fetchImpl?: FetchLike;
}

export function makeNodeCtx(opts: NodeCtxOptions = {}): ResolveCtx {
  const f: FetchLike = opts.fetchImpl ?? (fetch as unknown as FetchLike);

  let recordSink = opts.recordSink;
  if (!recordSink && opts.supabaseUrl && opts.supabaseServiceKey) {
    const url0 = opts.supabaseUrl;
    const key0 = opts.supabaseServiceKey;
    recordSink = (record: AiDecisionRecord) => {
      const { url, init } = buildRecordRequest(url0, key0, record);
      void f(url, init).catch(() => {});
    };
  }

  return {
    runtime: "node",
    config: opts.config ?? DEFAULT_CONFIG,
    transports: {
      anthropic: opts.anthropicApiKey ? { apiKey: opts.anthropicApiKey, fetch: f } : undefined,
      workersAi: opts.workersAi,
    },
    gateway: undefined,
    recordSink,
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    timeoutSignal: (ms: number) => AbortSignal.timeout(ms),
  };
}

export function resolveOnNode(task: ResolveTask, opts?: NodeCtxOptions): Promise<ResolveResult> {
  return resolve(task, makeNodeCtx(opts));
}
