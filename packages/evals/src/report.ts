/**
 * Rolling eval runs up into a Report and rendering it as a stable plain-text
 * table. The table uses spaces and "=" rules only: no em dashes and no " - "
 * hyphen separators, per the house style.
 */
import { confusionMatrix, metrics } from "./metrics";
import type { EvalRun, EvalSummary, Report } from "./types";

function summarize(name: string, run: EvalRun[], positiveLabel: string): EvalSummary {
  const results = run.flatMap((r) => r.results);
  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const cm = confusionMatrix(results, positiveLabel);
  return {
    name,
    total,
    passed,
    passRate: total === 0 ? 0 : passed / total,
    confusion: cm,
    metrics: metrics(cm),
  };
}

/** Build a Report from one or more eval runs. Each run becomes one row; a pooled
 *  "overall" summary aggregates every result across runs. */
export function buildReport(runs: EvalRun[], positiveLabel: string = "positive"): Report {
  return {
    evals: runs.map((run) => summarize(run.name, [run], positiveLabel)),
    overall: summarize("overall", runs, positiveLabel),
  };
}

const COLUMNS = ["eval", "n", "pass", "prec", "recall", "f1", "acc"] as const;

function pct(value: number): string {
  return value.toFixed(3);
}

function row(s: EvalSummary): string[] {
  return [
    s.name,
    String(s.total),
    pct(s.passRate),
    pct(s.metrics.precision),
    pct(s.metrics.recall),
    pct(s.metrics.f1),
    pct(s.metrics.accuracy),
  ];
}

/** Render a Report as a fixed-width plain-text table. Output is deterministic for
 *  a given report, so tests can assert on it exactly. */
export function formatReport(report: Report): string {
  const bodyRows = report.evals.map(row);
  const overallRow = row(report.overall);
  const allRows = [COLUMNS.map((c) => c), ...bodyRows, overallRow];

  const widths = COLUMNS.map((_, i) => Math.max(...allRows.map((r) => r[i].length)));

  const render = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").replace(/\s+$/, "");

  const rule = widths.map((w) => "=".repeat(w)).join("==");

  const lines: string[] = [];
  lines.push(render(COLUMNS.map((c) => c)));
  lines.push(rule);
  for (const r of bodyRows) lines.push(render(r));
  lines.push(rule);
  lines.push(render(overallRow));
  return lines.join("\n");
}
