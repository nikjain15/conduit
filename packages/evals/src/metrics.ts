/**
 * Confusion-matrix metrics for the offline harness.
 *
 * Each graded result carries a predicted `label` (a class) and a `pass` flag
 * (did the prediction match the reference?). Read against a chosen positive
 * label those two facts place every result into exactly one cell:
 *
 *   predicted positive + pass  -> TP  (correctly called positive)
 *   predicted positive + fail  -> FP  (called positive, was negative)
 *   predicted negative + fail  -> FN  (called negative, was positive)
 *   predicted negative + pass  -> TN  (correctly called negative)
 *
 * From the matrix the standard definitions follow. Division-by-zero degrades to
 * 0 (the neutral value) rather than NaN so reports stay renderable.
 */
import type { ConfusionMatrix, EvalResult, Metrics } from "./types";

const DEFAULT_POSITIVE = "positive";

function isConfusionMatrix(x: ConfusionMatrix | EvalResult[]): x is ConfusionMatrix {
  return !Array.isArray(x) && typeof (x as ConfusionMatrix).tp === "number";
}

/** Build a confusion matrix from graded results. `positiveLabel` selects which
 *  predicted class counts as positive (default "positive"). */
export function confusionMatrix(
  results: EvalResult[],
  positiveLabel: string = DEFAULT_POSITIVE,
): ConfusionMatrix {
  const cm: ConfusionMatrix = { tp: 0, fp: 0, fn: 0, tn: 0 };
  for (const r of results) {
    const predictedPositive = r.label === positiveLabel;
    if (predictedPositive) {
      if (r.pass) cm.tp += 1;
      else cm.fp += 1;
    } else {
      if (r.pass) cm.tn += 1;
      else cm.fn += 1;
    }
  }
  return cm;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Compute the named metric bundle from either a confusion matrix or raw results. */
export function metrics(
  input: ConfusionMatrix | EvalResult[],
  positiveLabel: string = DEFAULT_POSITIVE,
): Metrics {
  const cm = isConfusionMatrix(input) ? input : confusionMatrix(input, positiveLabel);
  const precision = ratio(cm.tp, cm.tp + cm.fp);
  const recall = ratio(cm.tp, cm.tp + cm.fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  const accuracy = ratio(cm.tp + cm.tn, cm.tp + cm.fp + cm.fn + cm.tn);
  return {
    precision,
    recall,
    f1,
    accuracy,
    support: cm.tp + cm.fp + cm.fn + cm.tn,
  };
}
