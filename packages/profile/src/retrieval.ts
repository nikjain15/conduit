/**
 * Per use case retrieval, driven by a named retriever registry.
 *
 * The profile only names a retriever by string (retrieval.source). This module
 * fills the shared `retrieverRegistry` with concrete builders that reuse
 * `@conduit/rag`, and adds a resolver plus a one call `retrieveFor` that runs
 * the resolved retriever, gates on the grounding threshold, and packs a token
 * budgeted context. Executors stay free of retriever specifics: they read a
 * profile and call `retrieveFor`.
 *
 * The two RAG failure modes are handled the same way `@conduit/rag` frames
 * them. Bad retrieval is caught here by `gateRetrieval`: when the top score is
 * below the profile's groundingThreshold, `retrieveFor` returns a not found
 * signal so the caller says not found instead of inventing an answer from a
 * weak context.
 */

import {
  Bm25Retriever,
  HybridRetriever,
  InMemoryVectorStore,
  buildContext,
  gateRetrieval,
} from "@conduit/rag";
import type { Doc, EmbedFn, RetrievalResult, Retriever } from "@conduit/rag";

import { retrieverRegistry } from "./registry.ts";
import type { RetrievalConfig, UseCaseProfile } from "./types.ts";

/**
 * Everything a builder needs that does not live on the profile: the corpus to
 * index and, for vector or hybrid retrieval, the embed function. `vectorWeight`
 * tunes the hybrid blend (1 is pure vector, 0 is pure lexical). `tokenBudget`
 * optionally overrides the derived context budget in `retrieveFor`.
 */
export interface RetrieverDeps {
  corpus: Doc[];
  embed?: EmbedFn;
  vectorWeight?: number;
  tokenBudget?: number;
}

/**
 * A builder turns a retrieval config plus deps into a ready, indexed retriever.
 * Config carries chunking, topK, and embedModel; deps carries the corpus and
 * the embed function.
 */
export type RetrieverBuilder = (
  config: RetrievalConfig,
  deps: RetrieverDeps,
) => Retriever;

/** Default hybrid blend when deps does not set one. */
const DEFAULT_VECTOR_WEIGHT = 0.5;
/** Fallback per chunk token budget when chunking is absent. */
const DEFAULT_CHUNK_TOKENS = 400;

/**
 * Split a document into overlapping, fixed size chunks measured in whitespace
 * words. `overlap` words are repeated at the head of each subsequent chunk.
 * Returns the document unchanged (as a single chunk) when chunking is absent or
 * the text already fits in one window.
 */
export function chunkDoc(doc: Doc, chunking?: RetrievalConfig["chunking"]): Doc[] {
  if (!chunking || chunking.size <= 0) return [{ id: doc.id, text: doc.text }];
  const words = doc.text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= chunking.size) return [{ id: doc.id, text: doc.text }];

  const overlap = Math.max(0, Math.min(chunking.overlap, chunking.size - 1));
  const step = chunking.size - overlap;
  const chunks: Doc[] = [];
  for (let start = 0, i = 0; start < words.length; start += step, i++) {
    const slice = words.slice(start, start + chunking.size);
    chunks.push({ id: `${doc.id}#${i}`, text: slice.join(" ") });
    if (start + chunking.size >= words.length) break;
  }
  return chunks;
}

/** Chunk every document in a corpus under one chunking config. */
function chunkCorpus(corpus: Doc[], chunking?: RetrievalConfig["chunking"]): Doc[] {
  return corpus.flatMap((doc) => chunkDoc(doc, chunking));
}

/** The embed function is required for vector and hybrid retrieval. */
function requireEmbed(deps: RetrieverDeps, retriever: string): EmbedFn {
  if (!deps.embed) {
    throw new Error(`retriever "${retriever}" needs an embed function in deps`);
  }
  return deps.embed;
}

/** Build a BM25 lexical retriever over the chunked corpus. */
const buildBm25: RetrieverBuilder = (config, deps) => {
  const retriever = new Bm25Retriever();
  retriever.add(chunkCorpus(deps.corpus, config.chunking));
  return retriever;
};

/**
 * Wrap a vector store so its first query waits for embedding to finish. The
 * store embeds asynchronously on `add`, so a builder that returned it directly
 * could race a query ahead of indexing. This defers `add` and gates `query`
 * behind the same promise, keeping the builder synchronous.
 */
function indexedVector(store: InMemoryVectorStore, chunks: Doc[]): Retriever {
  const ready = store.add(chunks);
  return {
    async query(query: string, topK: number): Promise<RetrievalResult[]> {
      await ready;
      return store.query(query, topK);
    },
  };
}

/** Build an in memory cosine vector retriever over the chunked corpus. */
const buildVector: RetrieverBuilder = (config, deps) => {
  const store = new InMemoryVectorStore(requireEmbed(deps, "vector"));
  return indexedVector(store, chunkCorpus(deps.corpus, config.chunking));
};

/** Build a weighted hybrid of BM25 and the in memory vector store. */
const buildHybrid: RetrieverBuilder = (config, deps) => {
  const chunks = chunkCorpus(deps.corpus, config.chunking);
  const lexical = new Bm25Retriever();
  lexical.add(chunks);
  const vector = indexedVector(
    new InMemoryVectorStore(requireEmbed(deps, "hybrid")),
    chunks,
  );
  return new HybridRetriever(lexical, vector, {
    vectorWeight: deps.vectorWeight ?? DEFAULT_VECTOR_WEIGHT,
  });
};

/** The registry names this module registers. */
export const RETRIEVER_NAMES = ["bm25", "vector", "hybrid"] as const;
export type RetrieverName = (typeof RETRIEVER_NAMES)[number];

/**
 * Register the built in builders on import. Re registering a name overwrites
 * it, so importing this module is idempotent.
 */
retrieverRegistry
  .register("bm25", buildBm25)
  .register("vector", buildVector)
  .register("hybrid", buildHybrid);

/** Read a builder by name from the shared registry. */
export function getRetrieverBuilder(name: string): RetrieverBuilder | undefined {
  return retrieverRegistry.get(name) as RetrieverBuilder | undefined;
}

/** A retriever resolved from a profile, with the config values a run needs. */
export interface ResolvedRetriever {
  source: string;
  retriever: Retriever;
  topK: number;
  groundingThreshold: number;
  tokenBudget: number;
}

/** Default topK when the config omits it. */
const DEFAULT_TOP_K = 5;

/**
 * Resolve the retriever named by `retrieval.source`, building it over the
 * corpus in deps with the config's chunking applied. Returns null for a
 * retrieval free use case (retrieval is null or undefined). Throws when the
 * named source is not a registered retriever.
 */
export function resolveRetriever(
  retrieval: RetrievalConfig | null | undefined,
  deps: RetrieverDeps,
): ResolvedRetriever | null {
  if (!retrieval) return null;
  const build = getRetrieverBuilder(retrieval.source);
  if (!build) {
    throw new Error(`no retriever registered under "${retrieval.source}"`);
  }
  const topK = retrieval.topK ?? DEFAULT_TOP_K;
  const chunkTokens = retrieval.chunking?.size ?? DEFAULT_CHUNK_TOKENS;
  const tokenBudget = deps.tokenBudget ?? chunkTokens * topK;
  return {
    source: retrieval.source,
    retriever: build(retrieval, deps),
    topK,
    groundingThreshold: retrieval.groundingThreshold ?? 0,
    tokenBudget,
  };
}

/** The outcome of running retrieval for one query. */
export interface RetrieveForResult {
  /** Ranked hits from the retriever, topK deep. */
  chunks: RetrievalResult[];
  /** True when the top score cleared the grounding threshold. */
  grounded: boolean;
  /** Token budgeted context packed from the chunks, empty when not grounded. */
  context: string;
  /** True when retrieval was too weak to answer from: the caller says not found. */
  notFound: boolean;
  /** Why grounding failed, present when notFound is true. */
  reason?: string;
}

/**
 * Run retrieval for a profile and query. Resolves the retriever, runs it topK
 * deep, and applies the grounding threshold through `gateRetrieval`. When the
 * top score is below the threshold, returns a not found signal with no context
 * so the caller declines to answer instead of inventing one. Otherwise packs a
 * token budgeted context with `buildContext`. Returns null for a retrieval free
 * use case.
 */
export async function retrieveFor(
  profile: Pick<UseCaseProfile, "retrieval">,
  query: string,
  deps: RetrieverDeps,
): Promise<RetrieveForResult | null> {
  const resolved = resolveRetriever(profile.retrieval, deps);
  if (!resolved) return null;

  const chunks = await resolved.retriever.query(query, resolved.topK);
  const gate = gateRetrieval(chunks, { minTopScore: resolved.groundingThreshold });

  if (!gate.hasRelevantContext) {
    return { chunks, grounded: false, context: "", notFound: true, reason: gate.reason };
  }

  const built = buildContext(chunks, resolved.tokenBudget);
  return { chunks, grounded: true, context: built.context, notFound: false };
}
