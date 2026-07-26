/**
 * Hybrid retriever: merge a lexical (BM25) result list with a vector result
 * list under a configurable weight.
 *
 * BM25 scores and cosine similarities live on different scales, so each list is
 * min-max normalized to [0, 1] before blending. The combined score is:
 *
 *   combined = vectorWeight * normVector + (1 - vectorWeight) * normLexical
 *
 * A document missing from one list contributes 0 from that side. vectorWeight
 * of 1 is pure vector, 0 is pure lexical.
 */

import type { RetrievalResult, Retriever } from "./types.ts";

export interface HybridOptions {
  /** Weight on the vector side, 0 to 1. Lexical side gets (1 - vectorWeight). */
  vectorWeight: number;
  /** How many results to pull from each retriever before merging. */
  candidateK?: number;
}

/** Min-max normalize a result list's scores into [0, 1] keyed by id. */
function normalize(results: RetrievalResult[]): Map<string, number> {
  const out = new Map<string, number>();
  if (results.length === 0) return out;
  let min = Infinity;
  let max = -Infinity;
  for (const r of results) {
    if (r.score < min) min = r.score;
    if (r.score > max) max = r.score;
  }
  const span = max - min;
  for (const r of results) {
    out.set(r.id, span === 0 ? 1 : (r.score - min) / span);
  }
  return out;
}

/** Pure merge of two already-retrieved lists. Exposed for testing determinism. */
export function mergeHybrid(
  lexical: RetrievalResult[],
  vector: RetrievalResult[],
  vectorWeight: number,
  topK: number,
): RetrievalResult[] {
  const w = Math.min(1, Math.max(0, vectorWeight));
  const normLex = normalize(lexical);
  const normVec = normalize(vector);
  const textById = new Map<string, string>();
  for (const r of lexical) textById.set(r.id, r.text);
  for (const r of vector) textById.set(r.id, r.text);

  const ids = new Set<string>([...normLex.keys(), ...normVec.keys()]);
  const merged: RetrievalResult[] = [];
  for (const id of ids) {
    const lex = normLex.get(id) ?? 0;
    const vec = normVec.get(id) ?? 0;
    merged.push({
      id,
      score: w * vec + (1 - w) * lex,
      text: textById.get(id) ?? "",
    });
  }
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, Math.max(0, topK));
}

export class HybridRetriever implements Retriever {
  private readonly lexical: Retriever;
  private readonly vector: Retriever;
  private readonly vectorWeight: number;
  private readonly candidateK: number;

  constructor(lexical: Retriever, vector: Retriever, options: HybridOptions) {
    this.lexical = lexical;
    this.vector = vector;
    this.vectorWeight = options.vectorWeight;
    this.candidateK = options.candidateK ?? 20;
  }

  async query(query: string, topK: number): Promise<RetrievalResult[]> {
    const k = Math.max(topK, this.candidateK);
    const [lex, vec] = await Promise.all([
      this.lexical.query(query, k),
      this.vector.query(query, k),
    ]);
    return mergeHybrid(lex, vec, this.vectorWeight, topK);
  }
}
