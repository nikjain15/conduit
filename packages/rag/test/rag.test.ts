import { describe, it, expect } from "vitest";
import {
  Bm25Retriever,
  InMemoryVectorStore,
  InMemoryPgVectorStore,
  HybridRetriever,
  mergeHybrid,
  buildContext,
  gateRetrieval,
  checkGroundedness,
  cosineSimilarity,
  type Doc,
  type EmbedFn,
  type RetrievalResult,
} from "../src/index.ts";

const DOCS: Doc[] = [
  { id: "cats", text: "Cats are small domesticated felines kept as household pets." },
  { id: "dogs", text: "Dogs are loyal domesticated canines and popular family pets." },
  { id: "photosynthesis", text: "Photosynthesis converts sunlight into chemical energy in plants." },
  { id: "postgres", text: "Postgres is a relational database with strong transactional guarantees." },
];

/** A toy bag-of-words embedder over a fixed vocabulary, purely for tests. */
function makeBagOfWordsEmbedder(vocab: string[]): EmbedFn {
  const index = new Map(vocab.map((w, i) => [w, i]));
  return (text: string) => {
    const vec = new Array(vocab.length).fill(0);
    for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
      const i = index.get(raw);
      if (i !== undefined) vec[i] += 1;
    }
    return vec;
  };
}

const VOCAB = [
  "cats", "felines", "pets", "dogs", "canines", "family",
  "photosynthesis", "sunlight", "plants", "postgres", "database", "relational",
];

describe("BM25 lexical retriever", () => {
  it("ranks the obviously relevant doc first", () => {
    const bm25 = new Bm25Retriever();
    bm25.add(DOCS);
    const results = bm25.querySync("domesticated feline pets", 4);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe("cats");
    // scores are sorted descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("rewards term frequency and penalizes irrelevant docs (no match => absent)", () => {
    const bm25 = new Bm25Retriever();
    bm25.add(DOCS);
    const results = bm25.querySync("postgres database", 10);
    expect(results[0].id).toBe("postgres");
    expect(results.find((r) => r.id === "photosynthesis")).toBeUndefined();
  });
});

describe("vector store (cosine)", () => {
  it("cosineSimilarity is 1 for identical vectors and 0 for orthogonal", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  it("InMemoryVectorStore ranks semantically nearest first", async () => {
    const embed = makeBagOfWordsEmbedder(VOCAB);
    const store = new InMemoryVectorStore(embed);
    await store.add(DOCS);
    const results = await store.query("felines and pets", 4);
    expect(results[0].id).toBe("cats");
  });

  it("InMemoryPgVectorStore satisfies the same contract via similaritySearch", async () => {
    const embed = makeBagOfWordsEmbedder(VOCAB);
    const store = new InMemoryPgVectorStore(embed, "rag_chunks");
    expect(store.tableName).toBe("rag_chunks");
    await store.add(DOCS);
    const q = await embed("relational database postgres");
    const results = await store.similaritySearch(q, 4);
    expect(results[0].id).toBe("postgres");
  });
});

describe("hybrid merge respects weight", () => {
  const lexical: RetrievalResult[] = [
    { id: "a", score: 10, text: "A" },
    { id: "b", score: 1, text: "B" },
  ];
  const vector: RetrievalResult[] = [
    { id: "b", score: 0.9, text: "B" },
    { id: "a", score: 0.1, text: "A" },
  ];

  it("weight=0 is pure lexical (a wins)", () => {
    const merged = mergeHybrid(lexical, vector, 0, 2);
    expect(merged[0].id).toBe("a");
  });

  it("weight=1 is pure vector (b wins)", () => {
    const merged = mergeHybrid(lexical, vector, 1, 2);
    expect(merged[0].id).toBe("b");
  });

  it("shifting weight flips the ranking", () => {
    const lowVec = mergeHybrid(lexical, vector, 0.2, 2);
    const highVec = mergeHybrid(lexical, vector, 0.8, 2);
    expect(lowVec[0].id).toBe("a");
    expect(highVec[0].id).toBe("b");
  });

  it("HybridRetriever blends live retrievers", async () => {
    const bm25 = new Bm25Retriever();
    bm25.add(DOCS);
    const vec = new InMemoryVectorStore(makeBagOfWordsEmbedder(VOCAB));
    await vec.add(DOCS);
    const hybrid = new HybridRetriever(bm25, vec, { vectorWeight: 0.5, candidateK: 4 });
    const results = await hybrid.query("domesticated felines pets", 4);
    expect(results[0].id).toBe("cats");
  });
});

describe("buildContext truncates to budget and reports drops", () => {
  const chunks: RetrievalResult[] = [
    { id: "c1", score: 3, text: "one two three four five" }, // 5 words
    { id: "c2", score: 2, text: "six seven eight nine ten" }, // 5 words
    { id: "c3", score: 1, text: "eleven twelve thirteen" }, // 3 words
  ];

  it("includes what fits and drops the rest", () => {
    const out = buildContext(chunks, 5, { separator: " ", allowTruncation: false });
    expect(out.includedIds).toEqual(["c1"]);
    expect(out.droppedIds).toEqual(["c2", "c3"]);
    expect(out.usedTokens).toBeLessThanOrEqual(5);
  });

  it("truncates the overflowing chunk to fill the budget", () => {
    const out = buildContext(chunks, 7, { separator: " ", allowTruncation: true });
    expect(out.includedIds).toContain("c1");
    expect(out.truncatedIds).toContain("c2");
    expect(out.usedTokens).toBeLessThanOrEqual(7);
    // c1 (5) + sep (1) + 1 word of c2 = 7
    expect(out.context.split(/\s+/).length).toBeLessThanOrEqual(7);
    expect(out.droppedIds).toContain("c3");
  });

  it("never exceeds the budget", () => {
    for (const budget of [0, 1, 4, 6, 20]) {
      const out = buildContext(chunks, budget, { separator: " " });
      expect(out.usedTokens).toBeLessThanOrEqual(budget);
    }
  });
});

describe("failure mode (a): bad retrieval gate", () => {
  it("low-score query returns the not-found signal", () => {
    const bm25 = new Bm25Retriever();
    bm25.add(DOCS);
    const results = bm25.querySync("quantum chromodynamics spacecraft", 4);
    const gate = gateRetrieval(results, { minTopScore: 0.5 });
    expect(gate.hasRelevantContext).toBe(false);
    expect(gate.reason).toBeDefined();
  });

  it("empty results are treated as no context", () => {
    const gate = gateRetrieval([], { minTopScore: 0.5 });
    expect(gate.hasRelevantContext).toBe(false);
    expect(gate.topScore).toBe(0);
  });

  it("a strong match clears the gate", () => {
    const bm25 = new Bm25Retriever();
    bm25.add(DOCS);
    const results = bm25.querySync("domesticated felines pets", 4);
    const gate = gateRetrieval(results, { minTopScore: 0.1 });
    expect(gate.hasRelevantContext).toBe(true);
  });
});

describe("failure mode (b): groundedness heuristic", () => {
  const chunks: RetrievalResult[] = [
    { id: "d", text: "Postgres is a relational database with strong transactional guarantees.", score: 1 },
  ];

  it("passes a supported claim", () => {
    const report = checkGroundedness(
      "Postgres is a relational database with transactional guarantees.",
      chunks,
    );
    expect(report.grounded).toBe(true);
    expect(report.unsupported).toHaveLength(0);
    expect(report.method).toBe("lexical-overlap-heuristic");
  });

  it("flags an unsupported claim", () => {
    const report = checkGroundedness(
      "Postgres was invented by aliens on Jupiter.",
      chunks,
    );
    expect(report.grounded).toBe(false);
    expect(report.unsupported.length).toBeGreaterThan(0);
  });

  it("flags only the unsupported sentence in a mixed answer", () => {
    const report = checkGroundedness(
      "Postgres is a relational database. It secretly runs on magic crystals.",
      chunks,
    );
    expect(report.grounded).toBe(false);
    const flagged = report.claims.find((c) => !c.supported);
    expect(flagged?.sentence).toContain("crystals");
    const ok = report.claims.find((c) => c.sentence.includes("relational database"));
    expect(ok?.supported).toBe(true);
  });
});
