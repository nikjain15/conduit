/**
 * The measurement. Calls real models, so it needs ANTHROPIC_API_KEY and costs
 * money. Skipped automatically when the key is absent, which is why the ordinary
 * CI run stays free and offline.
 *
 *   ANTHROPIC_API_KEY=... npx vitest run evals/judge-validation.live.test.ts
 *
 * It writes evals/results/judge-validation.json, which is committed. That file
 * is what turns "we have a judge" into "the judge agrees with human labels at
 * kappa X, measured on this date with these models". The free test in
 * judge-validation.test.ts then holds that number to its floor on every pull
 * request.
 *
 * Two models run so the comparison answers a question worth money: is the
 * expensive judge actually better at marking than the cheap one? If it is not,
 * the cheap one is the correct production choice.
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildResults, loadCases, validateModel } from "./run-judge-validation.ts";
import {
  enforcedFailures,
  kappaBand,
  type EnforcedPair,
  type ModelReport,
  type ValidationResults,
} from "./judge-metrics.ts";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "results");

/** Cheap first, then the stronger tier. The stronger model rejects sampling
 *  params, which callAnthropic handles by consulting the catalog. */
const MODELS = (process.env.JUDGE_MODELS ?? "claude-haiku-4-5,claude-sonnet-5").split(",");

/** Cohen's kappa floor. 0.6 is the common production threshold and the boundary
 *  between "moderate" and "substantial" agreement on the Landis and Koch scale. */
const KAPPA_FLOOR = Number(process.env.JUDGE_KAPPA_FLOOR ?? 0.6);

/** What Conduit claims is validated, and therefore holds to the floor. Measured
 *  2026-08-02: sonnet judges groundedness at kappa 0.93. Nothing else clears the
 *  floor, so nothing else is listed, and nothing else may gate live output. */
const ENFORCED: EnforcedPair[] = [{ model: "claude-sonnet-5", dimension: "faithfulness" }];

describe.skipIf(!API_KEY)("judge validation, live", () => {
  it(
    "measures every judge model against the labelled set and records the result",
    { timeout: 15 * 60_000 },
    async () => {
      const cases = loadCases();
      const reports: ModelReport[] = [];

      for (const model of MODELS) {
        const report = await validateModel(cases, model, API_KEY as string);
        reports.push(report);
        const { faithfulness: f, relevance: r } = report;
        console.log(
          `\n${model}\n` +
            `  faithfulness  kappa ${f.kappa.toFixed(3)} (${kappaBand(f.kappa)})  ` +
            `agreement ${(f.agreement * 100).toFixed(1)}%  base rate ${(f.baseRate * 100).toFixed(1)}%  ` +
            `caught ${(f.trueNegativeRate * 100).toFixed(1)}% of ungrounded answers\n` +
            `  relevance     kappa ${r.kappa.toFixed(3)} (${kappaBand(r.kappa)})  ` +
            `agreement ${(r.agreement * 100).toFixed(1)}%  base rate ${(r.baseRate * 100).toFixed(1)}%  ` +
            `caught ${(r.trueNegativeRate * 100).toFixed(1)}% of off-topic answers`,
        );
      }

      const ran = new Date().toISOString().slice(0, 10);
      const results: ValidationResults = buildResults(
        reports, cases.length, ran, KAPPA_FLOOR, ENFORCED,
      );
      mkdirSync(RESULTS_DIR, { recursive: true });
      writeFileSync(
        join(RESULTS_DIR, "judge-validation.json"),
        JSON.stringify(results, null, 2) + "\n",
      );

      // Assert only what this repo CLAIMS is validated. Every model measured is
      // recorded either way. A pair missing from `enforced` is not exempt, it is
      // unvalidated, and docs must not describe it as a working judge.
      expect(enforcedFailures(results), enforcedFailures(results).join("; ")).toEqual([]);
    },
  );
});
