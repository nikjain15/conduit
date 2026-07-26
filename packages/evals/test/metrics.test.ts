import { describe, expect, it } from "vitest";
import { confusionMatrix, metrics } from "../src/metrics";
import type { EvalResult } from "../src/types";

describe("metrics math", () => {
  it("computes precision, recall, F1, accuracy from a hand-built confusion matrix", () => {
    const cm = { tp: 3, fp: 1, fn: 2, tn: 4 };
    const m = metrics(cm);
    expect(m.precision).toBeCloseTo(0.75, 10); // 3 / (3 + 1)
    expect(m.recall).toBeCloseTo(0.6, 10); // 3 / (3 + 2)
    expect(m.f1).toBeCloseTo(2 / 3, 6); // 2 * .75 * .6 / (.75 + .6)
    expect(m.accuracy).toBeCloseTo(0.7, 10); // (3 + 4) / 10
    expect(m.support).toBe(10);
  });

  it("degrades to 0 rather than NaN on empty matrices", () => {
    const m = metrics({ tp: 0, fp: 0, fn: 0, tn: 0 });
    expect(m.precision).toBe(0);
    expect(m.recall).toBe(0);
    expect(m.f1).toBe(0);
    expect(m.accuracy).toBe(0);
    expect(m.support).toBe(0);
  });

  it("builds a confusion matrix from pass/label results", () => {
    const results: EvalResult[] = [
      { caseId: "a", pass: true, label: "positive" }, // TP
      { caseId: "b", pass: true, label: "positive" }, // TP
      { caseId: "c", pass: true, label: "positive" }, // TP
      { caseId: "d", pass: false, label: "positive" }, // FP
      { caseId: "e", pass: false, label: "negative" }, // FN
      { caseId: "f", pass: false, label: "negative" }, // FN
      { caseId: "g", pass: true, label: "negative" }, // TN
      { caseId: "h", pass: true, label: "negative" }, // TN
      { caseId: "i", pass: true, label: "negative" }, // TN
      { caseId: "j", pass: true, label: "negative" }, // TN
    ];
    expect(confusionMatrix(results)).toEqual({ tp: 3, fp: 1, fn: 2, tn: 4 });

    // metrics(results) must agree with metrics(matrix).
    const m = metrics(results);
    expect(m.precision).toBeCloseTo(0.75, 10);
    expect(m.recall).toBeCloseTo(0.6, 10);
    expect(m.accuracy).toBeCloseTo(0.7, 10);
  });

  it("honors a custom positive label", () => {
    const results: EvalResult[] = [
      { caseId: "a", pass: true, label: "spam" }, // TP
      { caseId: "b", pass: false, label: "spam" }, // FP
      { caseId: "c", pass: true, label: "ham" }, // TN
    ];
    expect(confusionMatrix(results, "spam")).toEqual({ tp: 1, fp: 1, fn: 0, tn: 1 });
  });
});
