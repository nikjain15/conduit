/**
 * The runner: drive a dataset through a generator and a checker, then aggregate.
 *
 * `generate` and `check` are both injected so the harness has no IO of its own:
 * tests pass pure functions, production passes a real generator and either a
 * deterministic checker or the LLM-judge checker (judgeCheck.ts). Cases run in
 * order; a generator that throws is recorded as a failing result rather than
 * aborting the whole run, so one bad case never voids the dataset.
 */
import type { Check, EvalDataset, EvalResult, EvalRun, Generate } from "./types";

export interface RunEvalArgs<I, E, O> {
  dataset: EvalDataset<I, E>;
  generate: Generate<I, O>;
  check: Check<I, E, O>;
  /** Predicted class assigned when generation throws. Default "negative". */
  errorLabel?: string;
}

export async function runEval<I, E, O>(args: RunEvalArgs<I, E, O>): Promise<EvalRun> {
  const { dataset, generate, check, errorLabel = "negative" } = args;
  const results: EvalResult[] = [];

  for (const testCase of dataset.cases) {
    try {
      const output = await generate(testCase.input);
      const outcome = await check(output, testCase);
      results.push({ caseId: testCase.id, ...outcome });
    } catch (err) {
      results.push({
        caseId: testCase.id,
        pass: false,
        label: errorLabel,
        rationale: `generate/check error: ${errMsg(err)}`,
      });
    }
  }

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  return {
    name: dataset.name,
    results,
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
  };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
}
