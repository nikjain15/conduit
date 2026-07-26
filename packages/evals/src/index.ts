/**
 * @conduit/evals public surface.
 *
 * The OFFLINE eval ladder: named datasets, a pluggable runner, deterministic and
 * LLM-as-judge checkers (the latter wrapping @conduit/inference's judge panel),
 * confusion-matrix metrics, and a plain-text report. This is the batch quality
 * harness; the INLINE runtime gate lives in @conduit/inference (judge.ts) and is
 * wrapped, not duplicated, here.
 */
export * from "./types";
export { confusionMatrix, metrics } from "./metrics";
export { runEval, type RunEvalArgs } from "./runner";
export { exactMatch, predicate } from "./checkers";
export { llmJudgeCheck, type JudgeModelCall, type LlmJudgeOptions } from "./judgeCheck";
export { buildReport, formatReport } from "./report";
