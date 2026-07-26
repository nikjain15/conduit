/**
 * @conduit/evals, core shapes for the OFFLINE eval ladder.
 *
 * This package is the batch evaluation harness that runs a named dataset through
 * a generator, grades each output with a checker, and rolls the pass/label
 * outcomes up into named metrics. It is deliberately separate from the INLINE
 * runtime gate/judge panel in @conduit/inference (judge.ts): that panel decides
 * whether ONE live answer may ship; this harness measures a generator's quality
 * across a fixed dataset offline. The LLM-as-judge checker here WRAPS that panel
 * (see judgeCheck.ts) rather than reimplementing it.
 */

/** One graded example. `expected` is optional so the same dataset serves both
 *  reference-based checks and reference-free judging. */
export interface EvalCase<I = unknown, E = unknown> {
  id: string;
  input: I;
  expected?: E;
}

/** A named collection of cases. The name is what a Report groups results under. */
export interface EvalDataset<I = unknown, E = unknown> {
  name: string;
  cases: Array<EvalCase<I, E>>;
}

/**
 * A checker's verdict for one case.
 *
 *  - `pass`  did the output satisfy the check (prediction matched the reference)?
 *  - `label` the predicted CLASS. For confusion-matrix metrics this is read as a
 *            binary class against `positiveLabel` (default "positive"): together
 *            with `pass` it pins the output into exactly one of TP/FP/FN/TN.
 */
export interface CheckOutcome {
  pass: boolean;
  label: string;
  /** Optional PII-free note for debugging / report drill-down. */
  rationale?: string;
}

/** A checker's verdict joined back to the case it graded. */
export interface EvalResult extends CheckOutcome {
  caseId: string;
}

/** Produce an output for a case input. May be sync or async; no network in tests. */
export type Generate<I = unknown, O = unknown> = (input: I) => O | Promise<O>;

/** Grade an output against its case. May be sync or async. */
export type Check<I = unknown, E = unknown, O = unknown> = (
  output: O,
  testCase: EvalCase<I, E>,
) => CheckOutcome | Promise<CheckOutcome>;

/** Confusion matrix over a binary positive/negative labelling. */
export interface ConfusionMatrix {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

/** The named metric bundle derived from a confusion matrix. */
export interface Metrics {
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  /** Total graded examples (tp + fp + fn + tn). */
  support: number;
}

/** The output of one runEval call over one dataset. */
export interface EvalRun {
  name: string;
  results: EvalResult[];
  total: number;
  passed: number;
  passRate: number;
}

/** Per-eval rollup that a Report renders. */
export interface EvalSummary {
  name: string;
  total: number;
  passed: number;
  passRate: number;
  confusion: ConfusionMatrix;
  metrics: Metrics;
}

/** The full report: one summary per eval plus a pooled overall summary. */
export interface Report {
  evals: EvalSummary[];
  overall: EvalSummary;
}
