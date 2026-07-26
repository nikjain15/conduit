# @conduit/rag

Pure, injectable retrieval and grounding primitives for Conduit. No live network
and no database driver live in this package: embedding and token estimation are
passed in as functions, so everything is deterministic and mockable in tests. A
real deployment wires the same interfaces to actual providers at the edge.

## What is here

1. **BM25 lexical retriever** (`Bm25Retriever`). Builds an in-memory index over
   `{ id, text }` documents and returns ranked `{ id, score, text }` hits with
   standard TF saturation, probabilistic IDF, and document-length normalization.

2. **Vector retrieval** (`InMemoryVectorStore`). A `VectorStore` takes an
   injected `embed` function and ranks by cosine similarity. `PgVectorStore` is
   an interface shape describing a Postgres plus pgvector backing;
   `InMemoryPgVectorStore` satisfies that contract for tests without any DB.

3. **Hybrid retriever** (`HybridRetriever`, `mergeHybrid`). Merges a lexical list
   and a vector list under a configurable `vectorWeight`. Each list is min-max
   normalized before blending so BM25 and cosine scales are comparable.

4. **Context packing** (`buildContext`). Packs retrieved chunks under a token
   budget in priority order, truncating the last chunk that only partially fits,
   and reports which chunks were included, truncated, and dropped.

5. **The two RAG failure modes**, handled explicitly:
   - **Bad retrieval** (`gateRetrieval`): if the top score is below a threshold,
     it returns a "no relevant context" signal so the caller says not-found
     instead of inventing an answer.
   - **Unfaithful answer** (`checkGroundedness`): flags answer sentences whose
     content words are not covered by any retrieved chunk. This is a
     lexical-overlap heuristic, named as such. It catches claims with no lexical
     anchor in the context. It does not detect paraphrased contradictions,
     negation flips, or numeric errors that reuse the same words, so a
     "grounded" verdict means "no obvious unsupported span found", not proof of
     truth.

## Public API

See `src/index.ts`. Core exports: `Bm25Retriever`, `InMemoryVectorStore`,
`InMemoryPgVectorStore`, `HybridRetriever`, `mergeHybrid`, `buildContext`,
`gateRetrieval`, `checkGroundedness`, `cosineSimilarity`, plus the `Doc`,
`RetrievalResult`, `Retriever`, `VectorStore`, `PgVectorStore`, and `EmbedFn`
types.

## Tests

`npx vitest run packages/rag` from the repo root.
