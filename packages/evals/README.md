# @conduit/evals

The offline evaluation ladder for Conduit. It runs a named dataset through a
generator, grades each output with a checker, and rolls the pass/label outcomes
into named metrics with a plain-text report.

This package is deliberately separate from the inline runtime gate in
`@conduit/inference` (`judge.ts`). That panel decides whether one live answer may
ship. This harness measures a generator's quality across a fixed dataset, offline.
The LLM-as-judge checker here wraps that panel rather than reimplementing it, so
there is one judging code path in the codebase.

## Concepts

- `EvalCase { id, input, expected? }`: one graded example. `expected` is optional
  so a dataset serves both reference-based checks and reference-free judging.
- `EvalDataset { name, cases }`: a named collection of cases.
- `generate(input) => output`: produces an output for a case. Injected, so the
  harness has no IO of its own.
- `check(output, case) => { pass, label }`: grades an output. Two kinds ship:
  a deterministic checker and an LLM-as-judge checker.

## Runner

```ts
import { runEval, exactMatch } from "@conduit/evals";

const run = await runEval({
  dataset,
  generate: (q) => answerFor(q),
  check: exactMatch(),
});
// run: { name, results, total, passed, passRate }
```

A generator that throws is recorded as a failing result, so one bad case never
voids the run.

## Checkers

Deterministic:

- `exactMatch()`: strict deep equality against `case.expected`.
- `predicate(fn, labelFor?)`: caller supplies the pass condition and, optionally,
  the predicted class per case.

LLM-as-judge (`llmJudgeCheck`) wraps the inference judge. The only injected
dependency is a `modelCall` that returns the judge model's raw reply text; it is
threaded through inference's one provider path, so tests mock a single function
and exercise the real panel (prompt framing, JSON verdict parsing, gate combine).

```ts
import { llmJudgeCheck } from "@conduit/evals";

const check = llmJudgeCheck({
  modelCall: async ({ user }) => callMyJudgeModel(user), // returns JSON verdict text
  criteria: "Grade whether the answer is grounded in the sources.",
});
```

## Metrics

Each result carries a predicted `label` (a class) and a `pass` flag. Read against
a positive label, those two facts place every result into one cell of a confusion
matrix:

| predicted \ correct | pass | fail |
| ------------------- | ---- | ---- |
| positive            | TP   | FP   |
| negative            | TN   | FN   |

`confusionMatrix(results)` builds the matrix; `metrics(matrixOrResults)` returns
`{ precision, recall, f1, accuracy, support }`. Division by zero degrades to 0
rather than NaN so reports stay renderable.

## Report

`buildReport(runs)` produces one summary per run plus a pooled overall summary.
`formatReport(report)` renders a fixed-width plain-text table using spaces and
`=` rules only, so its output is stable and diff-friendly.

## Test

From the repo root:

```
npx vitest run packages/evals
```
