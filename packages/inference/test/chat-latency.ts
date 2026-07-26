/**
 * Chat inline-judge LOAD TEST (the D3 gate before live-chat judging goes on).
 *
 * The live-chat budget is: added latency p95 < 500ms. This harness exercises the
 * inline gate path (deterministic floor + classifier triage, panel only on doubt)
 * with REALISTIC mocked model latencies and the same 400ms budget+fail-closed cap
 * the Worker uses, then asserts p95 < 500ms and that slow-judge runs are capped.
 *
 * Model calls are mocked (no network), but their latencies are real sleeps, so the
 * measured wall-clock reflects orchestration + the budget cap honestly. This is a
 * pre-launch gate, run on demand: `tsx packages/inference/test/chat-latency.ts`.
 */
import { judge, DEFAULT_ROSTER, type JudgeCtx, type JudgeInput, type JudgeOutcome } from "../src/judge";
import { DEFAULT_CONFIG, type ResolveCtx } from "../src/core";

const CLASSIFIER_MS = 120; // Workers-AI 8B fast-classifier, co-located
const PANEL_MS = 200; // Llama-70B / Mistral-24B panel member
const BUDGET_MS = 400; // the inline cap the Worker enforces
const N = 80; // iterations
const DOUBT_RATE = 0.2; // fraction of answers the classifier escalates

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Mock ctx: transports sleep a realistic time, then return a scripted verdict.
 *  `escalate` decides whether the classifier flags doubt for this run. */
function mockCtx(escalate: boolean): ResolveCtx {
  const verdict = (_model: string, system: string): Promise<string> => {
    if (system.includes("TRIAGE")) {
      return sleep(CLASSIFIER_MS).then(() => (escalate ? '{"clear":false,"suspect":["grounded"]}' : '{"clear":true,"suspect":[]}'));
    }
    return sleep(PANEL_MS).then(() => '{"pass":true,"reason":"ok"}');
  };
  return {
    runtime: "workers",
    config: DEFAULT_CONFIG,
    transports: {
      anthropic: {
        apiKey: "t",
        fetch: async (_u, init) => {
          const b = JSON.parse(init.body) as { model: string; system?: string };
          const text = await verdict(b.model, b.system ?? "");
          return { ok: true, status: 200, text: async () => "", json: async () => ({ model: b.model, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }) };
        },
      },
      workersAi: {
        run: async (model: string, input: unknown) => {
          const sys = (input as { messages: Array<{ role: string; content: string }> }).messages.find((m) => m.role === "system")?.content ?? "";
          return { response: await verdict(model, sys), usage: { prompt_tokens: 1, completion_tokens: 1 } };
        },
      },
    },
    now: () => Date.now(),
    sleep,
  };
}

const evals: JudgeInput["evals"] = [
  { key: "safety", version: 1, name: "safety", method: "deterministic", kind: "gate", mandatory: true, isFloor: true, enabled: true, checkRef: "safety_prefilter.v1", sampleRate: 1 },
  { key: "privacy", version: 1, name: "privacy", method: "deterministic", kind: "gate", mandatory: true, isFloor: true, enabled: true, checkRef: "privacy.v1", sampleRate: 1 },
  { key: "grounded", version: 1, name: "grounded", method: "llm_judge", kind: "gate", mandatory: false, isFloor: false, enabled: true, judgeCriteria: "ground it", sampleRate: 1 },
];

function jctx(escalate: boolean): JudgeCtx {
  return { resolveCtx: mockCtx(escalate), prices: DEFAULT_CONFIG.prices, now: () => Date.now(), random: () => 0, roster: DEFAULT_ROSTER, mode: "inline", phase: "gates", callTimeoutMs: BUDGET_MS };
}

const failClosed: JudgeOutcome = { evals: {}, gateStatus: "failed_closed", judgeCostUsd: 0, judgeLatencyMs: BUDGET_MS };

/** The same budget+fail-closed race the Worker's judgeChatGatesInline uses. */
async function inlineGate(escalate: boolean): Promise<{ ms: number; status: string }> {
  const input: JudgeInput = { useCase: "chat", tenantId: "anon:x", generator: { provider: "anthropic", model: "claude-haiku-4-5-20251001" }, question: "what's my balance?", answer: "Your balance is healthy.", evals };
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<JudgeOutcome>((res) => { timer = setTimeout(() => res(failClosed), BUDGET_MS); });
  const outcome = await Promise.race([judge(input, jctx(escalate)), budget]);
  if (timer) clearTimeout(timer);
  return { ms: Date.now() - start, status: outcome.gateStatus };
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main(): Promise<void> {
  const times: number[] = [];
  let capped = 0;
  let maxDoubt = 0;
  for (let i = 0; i < N; i++) {
    const escalate = i % Math.round(1 / DOUBT_RATE) === 0; // ~20% escalate
    const { ms, status } = await inlineGate(escalate);
    times.push(ms);
    if (escalate) {
      maxDoubt = Math.max(maxDoubt, ms);
      if (status === "failed_closed") capped++;
    }
  }
  const sorted = [...times].sort((a, b) => a - b);
  const p50 = pct(sorted, 50);
  const p95 = pct(sorted, 95);
  const max = sorted[sorted.length - 1];

  console.info(`runs=${N} doubt≈${Math.round(DOUBT_RATE * 100)}%  classifier=${CLASSIFIER_MS}ms panel=${PANEL_MS}ms budget=${BUDGET_MS}ms`);
  console.info(`added latency: p50=${p50}ms  p95=${p95}ms  max=${max}ms`);
  console.info(`doubt-path runs capped at budget: max=${maxDoubt}ms, fail-closed=${capped}`);

  let bad = 0;
  if (p95 >= 500) { console.error(`  ✗ p95 ${p95}ms ≥ 500ms budget`); bad++; } else console.info(`  ✓ p95 ${p95}ms < 500ms`);
  if (max > BUDGET_MS + 150) { console.error(`  ✗ a run exceeded budget+overhead (${max}ms)`); bad++; } else console.info(`  ✓ slow-judge runs capped at ~budget (max ${max}ms)`);
  if (bad) { console.error("\n✗ chat-latency: budget gate FAILED, do not enable live-chat judging."); process.exit(1); }
  console.info("\n✓ chat-latency: inline-judge added latency within the <500ms p95 budget (D3).");
}

main();
