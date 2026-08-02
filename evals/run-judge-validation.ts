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
  type EnforcedPair,
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

/**
 * Relevance is judged WITHOUT the source document, deliberately, and against the
 * SPECIFIC question rather than the general subject.
 *
 * Two measured iterations got here, both recorded in evals/README.md:
 *
 * v1 passed the source in and told the judge to ignore correctness. kappa 0.13.
 * It rejected on-topic-but-wrong answers anyway, because a judge holding a
 * document cannot resist checking against it. Instructing a model to ignore
 * information you just handed it does not work.
 *
 * v2 withheld the source, which is how RAGAS computes answer relevancy. kappa
 * 0.53, and the error flipped: it passed all 15 on-topic answers but caught only
 * 8 of 15 off-topic ones. Too lenient, because the off-topic answers discuss the
 * same document and so read as the same subject.
 *
 * v3 names that exact failure: same subject area is not the test, answering THIS
 * question is.
 */
export const RELEVANCE_CRITERIA =
  "You are checking RELEVANCE only, and you have deliberately not been shown any " +
  "source material, so you cannot verify facts and must not try. An answer full " +
  "of wrong figures is still relevant if it addresses the question. " +
  "Answer pass=true ONLY if the answer actually responds to the specific thing " +
  "that was asked. Ask yourself: if someone asked this question and received this " +
  "answer, would they have got a response to their question, or would they have to " +
  "ask again? If they would have to ask again, answer pass=false. " +
  "Being about the same general topic is NOT enough. An answer that supplies " +
  "adjacent or related information from the same document, without addressing what " +
  "was actually asked, is irrelevant and must fail. For example, if the question " +
  "asks about a deadline and the answer gives an amount, that fails even though " +
  "both concern the same contract.";

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
  withSource: boolean,
): Promise<Comparison[]> {
  const check = llmJudgeCheck<JudgeCase, unknown, string>({
    modelCall: (req) => callAnthropic(model, req, apiKey),
    criteria,
    // Faithfulness needs the source to check against. Relevance deliberately
    // does NOT get it: see RELEVANCE_CRITERIA for the measurement that forced
    // that change.
    toQuestion: (testCase) =>
      withSource
        ? `SOURCE:\n${testCase.input.source}\n\nQUESTION:\n${testCase.input.question}`
        : `QUESTION:\n${testCase.input.question}`,
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
    cases, FAITHFULNESS_CRITERIA, model, apiKey, (c) => c.gold.faithful, true,
  );
  const rel = await gradeDimension(
    cases, RELEVANCE_CRITERIA, model, apiKey, (c) => c.gold.relevant, false,
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
  enforced: EnforcedPair[],
): ValidationResults {
  return {
    ran,
    datasetVersion: "v1",
    cases,
    reports,
    kappaFloor,
    enforced,
    notes:
      "Labels are decidable from the source text, not opinion. Set is class " +
      "balanced 15/15 on both dimensions, so an always-pass judge scores 0.50 " +
      "agreement and kappa 0.",
  };
}
