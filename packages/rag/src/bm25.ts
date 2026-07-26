/**
 * In-memory BM25 lexical retriever.
 *
 * BM25 scores a document for a query as the sum over query terms of:
 *
 *   idf(t) * ( f(t,d) * (k1 + 1) ) / ( f(t,d) + k1 * (1 - b + b * |d| / avgdl) )
 *
 * where idf(t) uses the standard probabilistic form
 *
 *   idf(t) = ln( 1 + (N - df(t) + 0.5) / (df(t) + 0.5) )
 *
 * The "+1" inside the log keeps idf non-negative even for terms that appear in
 * more than half the corpus. k1 controls term-frequency saturation and b
 * controls document-length normalization.
 */

import type { Doc, RetrievalResult, Retriever } from "./types.ts";
import { tokenize } from "./tokenize.ts";

export interface Bm25Options {
  /** Term-frequency saturation. Typical range 1.2 to 2.0. */
  k1?: number;
  /** Length normalization strength, 0 (off) to 1 (full). */
  b?: number;
}

interface IndexedDoc {
  id: string;
  text: string;
  length: number;
  /** term -> raw frequency in this document */
  freqs: Map<string, number>;
}

export class Bm25Retriever implements Retriever {
  private readonly k1: number;
  private readonly b: number;
  private readonly docs: IndexedDoc[] = [];
  /** term -> number of documents containing it */
  private readonly df = new Map<string, number>();
  private totalLength = 0;

  constructor(options: Bm25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
  }

  /** Number of indexed documents. */
  get size(): number {
    return this.docs.length;
  }

  /** Index a batch of documents. Can be called multiple times. */
  add(docs: Doc[]): void {
    for (const doc of docs) {
      const tokens = tokenize(doc.text);
      const freqs = new Map<string, number>();
      for (const tok of tokens) {
        freqs.set(tok, (freqs.get(tok) ?? 0) + 1);
      }
      for (const term of freqs.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
      this.docs.push({
        id: doc.id,
        text: doc.text,
        length: tokens.length,
        freqs,
      });
      this.totalLength += tokens.length;
    }
  }

  private avgdl(): number {
    return this.docs.length === 0 ? 0 : this.totalLength / this.docs.length;
  }

  private idf(term: string): number {
    const n = this.docs.length;
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /** Score every document for the query and return the top-K by score. */
  async query(query: string, topK: number): Promise<RetrievalResult[]> {
    return this.querySync(query, topK);
  }

  /** Synchronous variant, convenient for pure tests. */
  querySync(query: string, topK: number): RetrievalResult[] {
    const terms = tokenize(query);
    const avgdl = this.avgdl();
    const results: RetrievalResult[] = [];

    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const f = doc.freqs.get(term);
        if (f === undefined) continue;
        const idf = this.idf(term);
        const denom =
          f + this.k1 * (1 - this.b + (this.b * doc.length) / (avgdl || 1));
        score += idf * ((f * (this.k1 + 1)) / denom);
      }
      if (score > 0) {
        results.push({ id: doc.id, score, text: doc.text });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, Math.max(0, topK));
  }
}
