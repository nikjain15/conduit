/**
 * Judge validation metrics.
 *
 * Raw agreement flatters a judge. If 80 percent of a set should pass, a judge
 * that says "pass" to everything scores 80 percent while carrying no signal at
 * all. Cohen's kappa corrects for the agreement you would expect by chance, so
 * the always-pass judge scores 0 no matter how skewed the set is.
 *
 * Reported alongside kappa, because kappa alone hides WHICH way a judge is
 * wrong: the per-class rates. A judge can have decent kappa while systematically
 * missing unfaithful answers, which is the failure that actually ships bad
 * output.
 *
 * Pure functions over recorded verdicts, so CI checks the arithmetic with no API
 * key. See run-judge-validation.ts for the part that calls a real model.
 */

/** One graded comparison: what the label says, what the judge said. */
export interface Comparison {
  gold: boolean;
  judge: boolean;
}

export interface AgreementStats {
  n: number;
  tp: number;
  fn: number;
  fp: number;
  tn: number;
  /** Raw agreement: the share the judge got right. */
  agreement: number;
  /** Accuracy a judge would score by always answering "true". The number raw
   *  agreement must beat to mean anything. */
  baseRate: number;
  /** Cohen's kappa: agreement corrected for chance. 1 perfect, 0 chance level,
   *  below 0 worse than chance. Production teams commonly require 0.6. */
  kappa: number;
  /** Of the cases that genuinely pass, the share the judge passed. Low means the
   *  judge wrongly rejects good output. */
  truePositiveRate: number;
  /** Of the cases that genuinely fail, the share the judge failed. Low means the
   *  judge lets bad output through, which is the dangerous direction. */
  trueNegativeRate: number;
}

const div = (a: number, b: number): number => (b === 0 ? 0 : a / b);

/**
 * Cohen's kappa for two binary raters.
 *
 *   po = observed agreement
 *   pe = agreement expected by chance, from the two raters' marginals
 *   k  = (po - pe) / (1 - pe)
 *
 * When the raters agree on every case AND both marginals are degenerate (both
 * always said the same class), pe is 1 and the formula divides by zero. That is
 * a set with no class variation rather than a perfect judge, so it returns 0 and
 * the caller should reject the set as unusable. The dataset's class balance
 * check exists to make that case impossible.
 */
export function agreementStats(comparisons: Comparison[]): AgreementStats {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let tn = 0;

  for (const { gold, judge } of comparisons) {
    if (gold && judge) tp++;
    else if (gold && !judge) fn++;
    else if (!gold && judge) fp++;
    else tn++;
  }

  const n = comparisons.length;
  const po = div(tp + tn, n);

  const goldTrue = tp + fn;
  const goldFalse = fp + tn;
  const judgeTrue = tp + fp;
  const judgeFalse = fn + tn;
  const pe = n === 0 ? 0 : (goldTrue * judgeTrue + goldFalse * judgeFalse) / (n * n);

  return {
    n,
    tp,
    fn,
    fp,
    tn,
    agreement: po,
    baseRate: div(goldTrue, n),
    kappa: pe >= 1 ? 0 : div(po - pe, 1 - pe),
    truePositiveRate: div(tp, goldTrue),
    trueNegativeRate: div(tn, goldFalse),
  };
}

/** Landis and Koch bands, the convention kappa is usually read against. */
export function kappaBand(kappa: number): string {
  if (kappa < 0) return "worse than chance";
  if (kappa < 0.21) return "slight";
  if (kappa < 0.41) return "fair";
  if (kappa < 0.61) return "moderate";
  if (kappa < 0.81) return "substantial";
  return "almost perfect";
}

/** One model's result across both graded dimensions. */
export interface ModelReport {
  model: string;
  faithfulness: AgreementStats;
  relevance: AgreementStats;
  /** Total USD spent producing this report, if the runner tracked it. */
  costUsd?: number;
}

export interface ValidationResults {
  /** ISO date of the run. A stale result is a stale claim. */
  ran: string;
  datasetVersion: string;
  cases: number;
  reports: ModelReport[];
  /** Floor both dimensions must clear for the judge to be considered validated. */
  kappaFloor: number;
  notes?: string;
}

/** A model passes validation only if BOTH dimensions clear the floor. A judge
 *  that grades groundedness well and relevance at chance is not validated. */
export function passesFloor(report: ModelReport, floor: number): boolean {
  return report.faithfulness.kappa >= floor && report.relevance.kappa >= floor;
}
