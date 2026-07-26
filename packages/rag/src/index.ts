/**
 * @conduit/rag public surface.
 *
 * Pure, injectable retrieval and grounding primitives:
 * lexical (BM25), vector (cosine, plus a pgvector interface shape), a hybrid
 * merger, token-budgeted context packing, and explicit handling of the two RAG
 * failure modes (bad retrieval, unfaithful answer).
 */

export type { Doc, RetrievalResult, Retriever } from "./types.ts";

export { tokenize, contentTokens, DEFAULT_STOPWORDS } from "./tokenize.ts";

export { Bm25Retriever } from "./bm25.ts";
export type { Bm25Options } from "./bm25.ts";

export {
  cosineSimilarity,
  InMemoryVectorStore,
  InMemoryPgVectorStore,
} from "./vector.ts";
export type {
  EmbedFn,
  VectorStore,
  PgVectorStore,
  EmbeddingRecord,
} from "./vector.ts";

export { HybridRetriever, mergeHybrid } from "./hybrid.ts";
export type { HybridOptions } from "./hybrid.ts";

export { buildContext, estimateTokensByWords } from "./context.ts";
export type { BuildContextOptions, BuiltContext } from "./context.ts";

export { gateRetrieval, checkGroundedness } from "./failure-modes.ts";
export type {
  RetrievalGateOptions,
  RetrievalGateResult,
  GroundednessOptions,
  GroundednessClaim,
  GroundednessReport,
} from "./failure-modes.ts";
