/**
 * Grounding step: pack retrieved chunks into a single context string under a
 * token budget, in priority order, truncating the final chunk if it only
 * partially fits. Reports which chunks were included and which were dropped so
 * callers can reason about coverage.
 */

import type { RetrievalResult } from "./types.ts";

/**
 * Default token estimator. This is an APPROXIMATION, not a model tokenizer:
 * it counts whitespace-delimited words. Inject `estimateTokens` for anything
 * that must match a specific model's tokenizer.
 */
export function estimateTokensByWords(text: string): number {
  const t = text.trim();
  if (t.length === 0) return 0;
  return t.split(/\s+/).length;
}

export interface BuildContextOptions {
  /** Token estimator. Defaults to a word-count approximation. */
  estimateTokens?: (text: string) => number;
  /** Joins included chunks. Its own token cost is charged to the budget. */
  separator?: string;
  /** If true, the first chunk that overflows is truncated to fill the budget. */
  allowTruncation?: boolean;
}

export interface BuiltContext {
  /** Assembled context string, ready to hand to the model. */
  context: string;
  /** Ids of chunks included (in priority order). */
  includedIds: string[];
  /** Ids of chunks dropped for lack of budget (in priority order). */
  droppedIds: string[];
  /** Ids whose text was truncated to fit. Subset of includedIds. */
  truncatedIds: string[];
  /** Estimated tokens used by the assembled context. */
  usedTokens: number;
  /** The budget the packing targeted. */
  budget: number;
}

/** Truncate text to approximately `maxTokens` under the word-count model. */
function truncateToTokens(
  text: string,
  maxTokens: number,
  estimate: (t: string) => number,
): string {
  if (maxTokens <= 0) return "";
  if (estimate(text) <= maxTokens) return text;
  const words = text.trim().split(/\s+/);
  // Word-count estimator is monotonic in word count, so slice directly.
  const kept = words.slice(0, maxTokens).join(" ");
  // Guard against estimators that are not pure word-count.
  if (estimate(kept) <= maxTokens) return kept;
  let lo = 0;
  let hi = words.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (estimate(words.slice(0, mid).join(" ")) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return words.slice(0, lo).join(" ");
}

/**
 * Pack chunks under `tokenBudget`. Chunks are processed in the order given,
 * which is treated as priority order (highest priority first). Callers that
 * want score ordering should pass results already sorted by score descending.
 */
export function buildContext(
  chunks: RetrievalResult[],
  tokenBudget: number,
  options: BuildContextOptions = {},
): BuiltContext {
  const estimate = options.estimateTokens ?? estimateTokensByWords;
  const separator = options.separator ?? "\n\n";
  const allowTruncation = options.allowTruncation ?? true;
  const sepTokens = estimate(separator);

  const includedIds: string[] = [];
  const droppedIds: string[] = [];
  const truncatedIds: string[] = [];
  const pieces: string[] = [];
  let used = 0;

  for (const chunk of chunks) {
    const cost = estimate(chunk.text);
    const sepCost = pieces.length === 0 ? 0 : sepTokens;
    const remaining = tokenBudget - used - sepCost;

    if (remaining <= 0) {
      droppedIds.push(chunk.id);
      continue;
    }
    if (cost <= remaining) {
      pieces.push(chunk.text);
      used += sepCost + cost;
      includedIds.push(chunk.id);
    } else if (allowTruncation) {
      const truncated = truncateToTokens(chunk.text, remaining, estimate);
      if (truncated.length > 0) {
        pieces.push(truncated);
        used += sepCost + estimate(truncated);
        includedIds.push(chunk.id);
        truncatedIds.push(chunk.id);
      } else {
        droppedIds.push(chunk.id);
      }
    } else {
      droppedIds.push(chunk.id);
    }
  }

  return {
    context: pieces.join(separator),
    includedIds,
    droppedIds,
    truncatedIds,
    usedTokens: used,
    budget: tokenBudget,
  };
}
