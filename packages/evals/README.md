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

## Check-method registry and the declarative gate

Evals are declarative and per use case. A `UseCaseProfile` names its gates in
`profile.evals`, each an `{ key, method, params?, threshold?, floor?, mandatory?,
when }` spec. `method` resolves against a pluggable registry, and the same spec
list drives both the inline gate and the offline harness.

Built-in methods register into `@conduit/profile`'s shared `methodRegistry` on
import. Each has one signature: `(ctx: { answer, retrieved?, input?, params?,
deps? }) => { pass, label?, detail? }` (sync or async).

- `regex`, `contains`: `params.pattern` match over the answer.
- `json_schema`: parse the answer as JSON and validate against `params.schema`.
- `numeric_match`: every `params.expected` figure appears in the answer.
- `pii_scan`: heuristic flag for emails, phone numbers, and card-like runs.
- `exact_match`: answer equals `params.expected`.
- `groundedness`: `@conduit/rag` lexical-overlap check against `retrieved`.
- `llm_judge`: wraps `llmJudgeCheck` with an injected `deps.judgeModelCall`.

`runGate(specs, ctx, deps)` runs the inline specs and combines them fail closed:
a mandatory or floor spec that fails blocks the response (`blocked`); one whose
method is missing or throws is `failed_closed`; otherwise `passed`. Only
`when: "inline"` specs run inline.

`runBatch(specs, dataset, deps)` runs each `when: "batch"` spec over a dataset
through `runEval`, returning named confusion-matrix metrics per spec. One spec
list, two surfaces.

```ts
import { runGate, runBatch, registerBuiltInMethods } from "@conduit/evals";

const out = await runGate(profile.evals, { answer, retrieved }, {});
// out: { decision: "passed" | "blocked" | "failed_closed", results: [...] }
```

## Report

`buildReport(runs)` produces one summary per run plus a pooled overall summary.
`formatReport(report)` renders a fixed-width plain-text table using spaces and
`=` rules only, so its output is stable and diff-friendly.

## Test

From the repo root:

```
npx vitest run packages/evals
```
