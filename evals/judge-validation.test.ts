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
import { agreementStats, enforcedFailures, kappaBand } from "./judge-metrics.ts";
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
  const results = existsSync(RESULTS_PATH)
    ? (JSON.parse(readFileSync(RESULTS_PATH, "utf8")) as ValidationResults)
    : undefined;
  const measured = results !== undefined && results.reports.length > 0;

  it("was measured against the current set, not an older one", () => {
    if (!measured) return;
    expect(results!.cases).toBe(CASES.length);
  });

  it("backs every claim it makes: each enforced pair clears the floor", () => {
    if (!measured) return;
    const failures = enforcedFailures(results!);
    expect(failures, failures.join("; ")).toEqual([]);
  });

  it("claims something, so the judge is not silently unvalidated everywhere", () => {
    if (!measured) return;
    // A results file with an empty `enforced` list would pass the check above
    // trivially while claiming nothing is validated. That is honest but useless,
    // and it must be a visible decision rather than a quiet default.
    expect(results!.enforced.length).toBeGreaterThan(0);
  });
});
