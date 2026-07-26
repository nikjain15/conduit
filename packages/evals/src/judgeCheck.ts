/**
 * LLM-as-judge checker that WRAPS the @conduit/inference judge panel.
 *
 * The offline harness does not reimplement judging: it hands each output to the
 * real `judge()` orchestrator from packages/inference/src/judge.ts, configured
 * with a single llm_judge gate eval, and reads the panel's verdict back as a
 * pass/label outcome. The only injected dependency is a `modelCall` that returns
 * the judge model's raw reply text. That call is threaded through inference's
 * one provider path (rawModelCall) via a fake Anthropic transport, so tests mock
 * a single function and exercise the genuine panel logic (prompt framing, JSON
 * verdict parsing, gate combination) rather than a stand-in.
 *
 * The judge model is deliberately a different family than the (declared)
 * generator so the panel's generator-family-aware selection (D20) admits it.
 */
import { buildInferenceConfig, type ModelRef, type ResolveCtx } from "../../inference/src/core";
import { judge, type EvalDef, type JudgeCtx, type JudgeInput } from "../../inference/src/judge";
import type { Check, CheckOutcome, EvalCase } from "./types";

/** The single injected primitive: given the judge prompt inference built, return
 *  the model's raw reply text (expected to contain a JSON verdict object). */
export type JudgeModelCall = (req: {
  system?: string;
  user: string;
}) => string | Promise<string>;

export interface LlmJudgeOptions<I = unknown, E = unknown, O = unknown> {
  /** Injected, mockable model call. */
  modelCall: JudgeModelCall;
  /** Grading rubric passed to the judge (judge_criteria). */
  criteria: string;
  /** Eval key recorded by the judge. Default "quality". */
  evalKey?: string;
  /** Extract the user question from a case. Default String(case.input). */
  toQuestion?: (testCase: EvalCase<I, E>) => string;
  /** Extract the answer text to grade. Default String(output). */
  toAnswer?: (output: O, testCase: EvalCase<I, E>) => string;
  /** Judge model. Default a Sonnet checker (Anthropic family). */
  judgeModel?: ModelRef;
}

// Declared generator family (meta) differs from the Anthropic judge so the panel
// accepts the judge. This is metadata only: no generator model is ever called.
const DECLARED_GENERATOR: ModelRef = {
  provider: "workers-ai",
  model: "@cf/meta/llama-3.1-8b-instruct-fast",
};

function makeResolveCtx(modelCall: JudgeModelCall): ResolveCtx {
  return {
    runtime: "node",
    config: buildInferenceConfig(null),
    transports: {
      anthropic: {
        apiKey: "offline-eval",
        // Inference builds the Anthropic request body; we parse the prompt back
        // out, hand it to the injected call, and wrap the reply in the shape the
        // Anthropic path expects. No network is touched.
        fetch: async (_url, init) => {
          const body = JSON.parse(init.body) as {
            system?: unknown;
            messages?: Array<{ role: string; content: string }>;
          };
          const system = typeof body.system === "string" ? body.system : undefined;
          const messages = body.messages ?? [];
          const user = messages.length ? messages[messages.length - 1].content : "";
          const text = await modelCall({ system, user });
          return {
            ok: true,
            status: 200,
            text: async () => text,
            json: async () => ({
              model: "offline-eval-judge",
              content: [{ type: "text", text }],
              usage: { input_tokens: 0, output_tokens: 0 },
            }),
          };
        },
      },
    },
    now: () => 0,
    sleep: async () => {},
  };
}

/**
 * Build a `Check` that grades each output with the inference judge panel.
 */
export function llmJudgeCheck<I = unknown, E = unknown, O = unknown>(
  opts: LlmJudgeOptions<I, E, O>,
): Check<I, E, O> {
  const evalKey = opts.evalKey ?? "quality";
  const judgeModel = opts.judgeModel ?? { provider: "anthropic", model: "claude-sonnet-4-6" };
  const toQuestion = opts.toQuestion ?? ((c: EvalCase<I, E>) => String(c.input));
  const toAnswer = opts.toAnswer ?? ((o: O) => String(o));

  const resolveCtx = makeResolveCtx(opts.modelCall);
  const jctx: JudgeCtx = {
    resolveCtx,
    prices: {},
    now: () => 0,
    random: () => 0,
    roster: {
      fastClassifier: judgeModel,
      panel: [judgeModel],
      strong: judgeModel,
    },
    mode: "async",
    phase: "gates",
  };

  const evalDef: EvalDef = {
    key: evalKey,
    version: 1,
    name: opts.criteria.slice(0, 60),
    method: "llm_judge",
    kind: "gate",
    mandatory: true,
    isFloor: false,
    enabled: true,
    judgeCriteria: opts.criteria,
    threshold: null,
    checkRef: null,
    sampleRate: 1,
    panelPolicy: { size: 1 },
  };

  return async (output, testCase): Promise<CheckOutcome> => {
    const input: JudgeInput = {
      useCase: "offline_eval",
      tenantId: "offline",
      generator: DECLARED_GENERATOR,
      question: toQuestion(testCase),
      answer: toAnswer(output, testCase),
      answerJson: undefined,
      context: null,
      evals: [evalDef],
    };
    const outcome = await judge(input, jctx);
    const r = outcome.evals[evalKey];
    const pass = r?.pass === true;
    return {
      pass,
      label: pass ? "positive" : "negative",
      rationale: r?.rationale,
    };
  };
}
