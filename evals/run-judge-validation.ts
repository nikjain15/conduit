/**
 * Runs the real judge over the validation set and records how well it marks.
 *
 * This is the only file in evals/ that touches the network. Everything else
 * scores offline. It grades each case twice, once for faithfulness and once for
 * relevance, because those fail for different reasons and need different fixes
 * (RAGAS / TruLens / DeepEval and Anthropic's agent guidance all decompose this
 * way).
 *
 * It validates the SHIPPED judge: `llmJudgeCheck` from @conduit/evals, which
 * wraps the inference judge panel. The panel builds the prompt and parses the
 * verdict; the only thing injected here is the function that actually calls a
 * model. So a passing number is evidence about the judge Conduit ships, not
 * about a copy written for the test.
 *
 * Note on sampling params: the panel sets temperature 0 internally, but the
 * panel's transport is faked by llmJudgeCheck, so nothing reaches the provider
 * except what `callAnthropic` below sends. That function consults the catalog
 * and omits sampling params for models that reject them, which is the contract
 * core.ts does not yet honour (see evals/dataset/model-contract.jsonl).
 */
import { llmJudgeCheck } from "../packages/evals/src/index.ts";
import { CURATED_MODELS } from "../packages/catalog/src/curated.ts";
import { loadJsonl } from "./harness.ts";
import {
  agreementStats,
  type Comparison,
  type ModelReport,
  type ValidationResults,
} from "./judge-metrics.ts";

export interface JudgeCase {
  id: string;
  band: string;
  source: string;
  question: string;
  answer: string;
  gold: { faithful: boolean; relevant: boolean };
  why: string;
}

/** The two rubrics. Each asks for ONE binary judgement, which is what keeps a
 *  verdict checkable. A combined "is this good" prompt cannot be validated
 *  because two people will disagree about what good means. */
export const FAITHFULNESS_CRITERIA =
  "You are checking GROUNDEDNESS only. Answer pass=true if every factual claim in " +
  "the answer is supported by the SOURCE text provided in the question. Answer " +
  "pass=false if the answer states any figure, date, entity or fact that " +
  "contradicts the source or does not appear in it. Do NOT consider whether the " +
  "answer is helpful or on-topic; an unhelpful but fully supported answer passes.";

export const RELEVANCE_CRITERIA =
  "You are checking RELEVANCE only. Answer pass=true if the answer addresses the " +
  "question that was asked. Answer pass=false if the answer discusses something " +
  "else, however accurate it may be. Do NOT consider whether the answer is " +
  "factually correct or supported by the source; a wrong but on-topic answer passes.";

/** Anthropic call. Omits sampling params for models the catalog says reject
 *  them, so a reasoning-tier judge does not fail with an opaque HTTP 400. */
export async function callAnthropic(
  model: string,
  req: { system?: string; user: string },
  apiKey: string,
): Promise<string> {
  const accepts = CURATED_MODELS.find((m) => m.id === model)?.supportsSampling;
  const body: Record<string, unknown> = {
    model,
    max_tokens: 512,
    messages: [{ role: "user", content: req.user }],
  };
  if (req.system) body.system = req.system;
  if (accepts === true) body.temperature = 0;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`judge call failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  return (json.content ?? []).map((c) => c.text ?? "").join("");
}

/** Grade every case on one dimension with one model, through the shipped judge. */
async function gradeDimension(
  cases: JudgeCase[],
  criteria: string,
  model: string,
  apiKey: string,
  goldOf: (c: JudgeCase) => boolean,
): Promise<Comparison[]> {
  const check = llmJudgeCheck<JudgeCase, unknown, string>({
    modelCall: (req) => callAnthropic(model, req, apiKey),
    criteria,
    // The judge sees the source and the question together, mirroring how a
    // grounded answer is judged in production.
    toQuestion: (testCase) =>
      `SOURCE:\n${testCase.input.source}\n\nQUESTION:\n${testCase.input.question}`,
    toAnswer: (output) => output,
  });

  const out: Comparison[] = [];
  for (const c of cases) {
    const outcome = await check(c.answer, { id: c.id, input: c });
    out.push({ gold: goldOf(c), judge: outcome.pass });
  }
  return out;
}

/** Run the full validation for one model. */
export async function validateModel(
  cases: JudgeCase[],
  model: string,
  apiKey: string,
): Promise<ModelReport> {
  const faith = await gradeDimension(
    cases, FAITHFULNESS_CRITERIA, model, apiKey, (c) => c.gold.faithful,
  );
  const rel = await gradeDimension(
    cases, RELEVANCE_CRITERIA, model, apiKey, (c) => c.gold.relevant,
  );
  return {
    model,
    faithfulness: agreementStats(faith),
    relevance: agreementStats(rel),
  };
}

export function loadCases(): JudgeCase[] {
  return loadJsonl<JudgeCase>("judge-validation.jsonl");
}

export function buildResults(
  reports: ModelReport[],
  cases: number,
  ran: string,
  kappaFloor: number,
): ValidationResults {
  return {
    ran,
    datasetVersion: "v1",
    cases,
    reports,
    kappaFloor,
    notes:
      "Labels are decidable from the source text, not opinion. Set is class " +
      "balanced 15/15 on both dimensions, so an always-pass judge scores 0.50 " +
      "agreement and kappa 0.",
  };
}
