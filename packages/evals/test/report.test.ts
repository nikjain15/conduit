import { describe, expect, it } from "vitest";
import { buildReport, formatReport } from "../src/report";
import type { EvalRun } from "../src/types";

// A run whose results reproduce the canonical TP=3 FP=1 FN=2 TN=4 matrix.
const canonicalRun: EvalRun = {
  name: "classify",
  total: 10,
  passed: 7,
  passRate: 0.7,
  results: [
    { caseId: "a", pass: true, label: "positive" },
    { caseId: "b", pass: true, label: "positive" },
    { caseId: "c", pass: true, label: "positive" },
    { caseId: "d", pass: false, label: "positive" },
    { caseId: "e", pass: false, label: "negative" },
    { caseId: "f", pass: false, label: "negative" },
    { caseId: "g", pass: true, label: "negative" },
    { caseId: "h", pass: true, label: "negative" },
    { caseId: "i", pass: true, label: "negative" },
    { caseId: "j", pass: true, label: "negative" },
  ],
};

describe("buildReport", () => {
  it("computes a per-eval summary and a pooled overall", () => {
    const report = buildReport([canonicalRun]);
    expect(report.evals).toHaveLength(1);
    const s = report.evals[0];
    expect(s.confusion).toEqual({ tp: 3, fp: 1, fn: 2, tn: 4 });
    expect(s.metrics.precision).toBeCloseTo(0.75, 10);
    expect(s.metrics.recall).toBeCloseTo(0.6, 10);
    expect(s.metrics.accuracy).toBeCloseTo(0.7, 10);
    expect(report.overall.total).toBe(10);
    expect(report.overall.passed).toBe(7);
  });
});

describe("formatReport", () => {
  const report = buildReport([canonicalRun]);
  const text = formatReport(report);

  it("renders a stable plain-text table", () => {
    expect(text).toBe(
      [
        "eval      n   pass   prec   recall  f1     acc",
        "================================================",
        "classify  10  0.700  0.750  0.600   0.667  0.700",
        "================================================",
        "overall   10  0.700  0.750  0.600   0.667  0.700",
      ].join("\n"),
    );
  });

  it("contains no em dashes and no hyphen separators", () => {
    expect(text).not.toContain(","); // em dash
    expect(text).not.toContain(" - "); // hyphen separator
  });
});
