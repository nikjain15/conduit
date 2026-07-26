/**
 * Deterministic checkers: reference-based verdicts computed by pure code, no
 * model in the loop. These are the offline analogue of the judge's deterministic
 * floor gates. Each factory returns a `Check` the runner can call.
 */
import type { Check, CheckOutcome, EvalCase } from "./types";

const POSITIVE = "positive";
const NEGATIVE = "negative";

/** Map a boolean match to a positive/negative predicted class. A matched case is
 *  a predicted positive that passed (TP); a miss is a predicted negative that
 *  failed (FN) under the default positive-label convention. */
function outcomeFromMatch(matched: boolean, rationale?: string): CheckOutcome {
  return matched
    ? { pass: true, label: POSITIVE, rationale }
    : { pass: false, label: NEGATIVE, rationale };
}

/** Strict deep-equality checker against `case.expected` (JSON-stable compare). */
export function exactMatch<I = unknown, O = unknown>(): Check<I, O, O> {
  return (output, testCase) => {
    const matched = stableEqual(output, testCase.expected);
    return outcomeFromMatch(matched, matched ? "exact match" : "output differs from expected");
  };
}

/** Predicate checker: caller supplies the pass condition and, optionally, the
 *  predicted class per case (defaults to positive/negative from the boolean). */
export function predicate<I = unknown, E = unknown, O = unknown>(
  fn: (output: O, testCase: EvalCase<I, E>) => boolean,
  labelFor?: (output: O, testCase: EvalCase<I, E>) => string,
): Check<I, E, O> {
  return (output, testCase) => {
    const matched = fn(output, testCase);
    const base = outcomeFromMatch(matched);
    return labelFor ? { ...base, label: labelFor(output, testCase) } : base;
  };
}

function stableEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") return stableStringify(a) === stableStringify(b);
  return false;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
