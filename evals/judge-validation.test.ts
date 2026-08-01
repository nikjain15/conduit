/**
 * Free checks on the judge validation set and its recorded result.
 *
 * Runs in CI with no API key and no network. It cannot measure the judge, but it
 * can guarantee the set stays capable of measuring it, and that any published
 * number still clears its floor. The measurement itself is
 * judge-validation.live.test.ts.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { agreementStats, kappaBand, passesFloor } from "./judge-metrics.ts";
import { loadCases, type JudgeCase } from "./run-judge-validation.ts";
import type { ValidationResults } from "./judge-metrics.ts";

const CASES = loadCases();
const RESULTS_PATH = join(dirname(fileURLToPath(import.meta.url)), "results", "judge-validation.json");

describe("judge validation set", () => {
  it("is large enough for kappa to be stable", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(30);
  });

  it("is class balanced on both dimensions, so raw agreement cannot flatter", () => {
    const faithful = CASES.filter((c) => c.gold.faithful).length;
    const relevant = CASES.filter((c) => c.gold.relevant).length;
    // Within one case of an even split. A skewed set lets an always-pass judge
    // post a high agreement number while carrying no signal.
    expect(Math.abs(faithful - CASES.length / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(relevant - CASES.length / 2)).toBeLessThanOrEqual(1);
  });

  it("covers all four combinations of the two dimensions", () => {
    const combos = new Set(CASES.map((c) => `${c.gold.faithful}/${c.gold.relevant}`));
    expect(combos).toEqual(new Set(["true/true", "true/false", "false/true", "false/false"]));
  });

  it("gives every case a written reason its label is undeniable", () => {
    const missing = CASES.filter((c: JudgeCase) => !c.why || c.why.length < 25).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("keeps case ids unique and stable", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });
});

describe("agreement metrics", () => {
  it("scores an always-pass judge at chance, however skewed the set", () => {
    // 8 of 10 genuinely pass. An always-pass judge gets 80 percent agreement,
    // which looks strong and means nothing. Kappa is the number that says so.
    const alwaysPass = [
      ...Array(8).fill({ gold: true, judge: true }),
      ...Array(2).fill({ gold: false, judge: true }),
    ];
    const s = agreementStats(alwaysPass);
    expect(s.agreement).toBeCloseTo(0.8, 5);
    expect(s.kappa).toBe(0);
    expect(s.trueNegativeRate).toBe(0);
  });

  it("scores a perfect judge at 1", () => {
    const s = agreementStats([
      { gold: true, judge: true },
      { gold: false, judge: false },
      { gold: true, judge: true },
      { gold: false, judge: false },
    ]);
    expect(s.agreement).toBe(1);
    expect(s.kappa).toBe(1);
  });

  it("goes negative when a judge is worse than chance", () => {
    const s = agreementStats([
      { gold: true, judge: false },
      { gold: false, judge: true },
      { gold: true, judge: false },
      { gold: false, judge: true },
    ]);
    expect(s.kappa).toBeLessThan(0);
    expect(kappaBand(s.kappa)).toBe("worse than chance");
  });

  it("separates the two ways a judge is wrong", () => {
    // Passes everything that should pass, but also passes half of what should
    // fail. Decent agreement, dangerous behaviour: bad output ships.
    const s = agreementStats([
      ...Array(10).fill({ gold: true, judge: true }),
      ...Array(5).fill({ gold: false, judge: true }),
      ...Array(5).fill({ gold: false, judge: false }),
    ]);
    expect(s.truePositiveRate).toBe(1);
    expect(s.trueNegativeRate).toBeCloseTo(0.5, 5);
  });

  it("reports the base rate a judge must beat", () => {
    const s = agreementStats([
      ...Array(15).fill({ gold: true, judge: true }),
      ...Array(15).fill({ gold: false, judge: false }),
    ]);
    expect(s.baseRate).toBe(0.5);
  });
});

describe("recorded validation result", () => {
  it("either has never been run, or clears its floor on every model", () => {
    if (!existsSync(RESULTS_PATH)) return;
    const results = JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as ValidationResults;
    if (results.reports.length === 0) return; // placeholder: not yet run

    expect(results.cases).toBe(CASES.length);
    for (const report of results.reports) {
      expect(
        passesFloor(report, results.kappaFloor),
        `${report.model}: faithfulness kappa ${report.faithfulness.kappa.toFixed(2)}, ` +
          `relevance kappa ${report.relevance.kappa.toFixed(2)}, floor ${results.kappaFloor}`,
      ).toBe(true);
    }
  });
});
