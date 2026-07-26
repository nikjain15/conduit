import { describe, expect, it } from "vitest";
import {
  RETRIEVER_NAMES,
  chunkDoc,
  getRetrieverBuilder,
  resolveRetriever,
  retrieveFor,
} from "../src/index.ts";
import { retrieverRegistry } from "../src/registry.ts";
import type { RetrieverDeps } from "../src/index.ts";
import type { Doc } from "@conduit/rag";
import type { RetrievalConfig } from "../src/types.ts";

/* A tiny deterministic bag of words embedding over a fixed vocabulary, so
 * cosine similarity is meaningful without a live model. */
const VOCAB = ["refund", "policy", "invoice", "billing", "password", "reset", "vpn", "network"];
function embed(text: string): number[] {
  const lower = text.toLowerCase();
  return VOCAB.map((w) => (lower.includes(w) ? 1 : 0));
}

const CORPUS: Doc[] = [
  { id: "refunds", text: "Our refund policy allows a refund within thirty days of purchase." },
  { id: "billing", text: "An invoice for billing is sent at the start of each billing cycle." },
  { id: "password", text: "To reset your password use the password reset link on the login page." },
  { id: "vpn", text: "Connect to the corporate network with the company vpn client." },
];

const deps: RetrieverDeps = { corpus: CORPUS, embed };

/* ── Registry ─────────────────────────────────────────────────────────────── */

describe("retriever registry", () => {
  it("registers bm25, vector, and hybrid builders on import", () => {
    for (const name of RETRIEVER_NAMES) {
      expect(retrieverRegistry.has(name)).toBe(true);
      expect(typeof getRetrieverBuilder(name)).toBe("function");
    }
  });

  it("builds a working retriever of each type", async () => {
    const config: RetrievalConfig = { source: "bm25", topK: 2 };
    for (const name of RETRIEVER_NAMES) {
      const build = getRetrieverBuilder(name)!;
      const retriever = build({ ...config, source: name }, deps);
      const hits = await retriever.query("refund policy", 2);
      expect(hits.length).toBeGreaterThan(0);
      // The refund document is the most relevant for every retriever type.
      expect(hits[0].id).toBe("refunds");
    }
  });

  it("throws when a vector retriever is built without an embed function", () => {
    const build = getRetrieverBuilder("vector")!;
    expect(() => build({ source: "vector" }, { corpus: CORPUS })).toThrow();
  });
});

/* ── resolveRetriever ─────────────────────────────────────────────────────── */

describe("resolveRetriever", () => {
  it("returns null for a retrieval free use case", () => {
    expect(resolveRetriever(null, deps)).toBe(null);
    expect(resolveRetriever(undefined, deps)).toBe(null);
  });

  it("selects the retriever named by source and carries topK", () => {
    const resolved = resolveRetriever({ source: "bm25", topK: 3 }, deps);
    expect(resolved).not.toBe(null);
    expect(resolved!.source).toBe("bm25");
    expect(resolved!.topK).toBe(3);
  });

  it("throws for an unregistered source", () => {
    expect(() => resolveRetriever({ source: "does-not-exist" }, deps)).toThrow();
  });

  it("honors topK by limiting the result count", async () => {
    const resolved = resolveRetriever({ source: "bm25", topK: 1 }, deps)!;
    const hits = await resolved.retriever.query("refund billing password network", 1);
    expect(hits.length).toBe(1);
  });
});

/* ── chunking ─────────────────────────────────────────────────────────────── */

describe("chunkDoc", () => {
  it("returns a single chunk when the text fits the window", () => {
    const chunks = chunkDoc({ id: "d", text: "one two three" }, { size: 10, overlap: 2 });
    expect(chunks.length).toBe(1);
    expect(chunks[0].id).toBe("d");
  });

  it("splits into overlapping fixed size chunks", () => {
    const text = Array.from({ length: 10 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkDoc({ id: "d", text }, { size: 4, overlap: 1 });
    // step = 3, so windows start at 0, 3, 6 and the last one covers w6..w9.
    expect(chunks.length).toBe(3);
    expect(chunks[0].text.split(" ")).toEqual(["w0", "w1", "w2", "w3"]);
    // overlap of 1: the second chunk repeats the last word of the first.
    expect(chunks[1].text.split(" ")[0]).toBe("w3");
    expect(chunks[2].text.split(" ")).toEqual(["w6", "w7", "w8", "w9"]);
    expect(chunks.map((c) => c.id)).toEqual(["d#0", "d#1", "d#2"]);
  });
});

/* ── retrieveFor ──────────────────────────────────────────────────────────── */

describe("retrieveFor", () => {
  it("returns null for a retrieval free profile", async () => {
    const out = await retrieveFor({ retrieval: null }, "anything", deps);
    expect(out).toBe(null);
  });

  it("returns grounded chunks and a packed context for a relevant query", async () => {
    const config: RetrievalConfig = {
      source: "vector",
      topK: 2,
      groundingThreshold: 0.3,
    };
    const out = await retrieveFor({ retrieval: config }, "refund policy", deps);
    expect(out).not.toBe(null);
    expect(out!.grounded).toBe(true);
    expect(out!.notFound).toBe(false);
    expect(out!.chunks[0].id).toBe("refunds");
    expect(out!.context.length).toBeGreaterThan(0);
    expect(out!.context).toContain("refund");
  });

  it("returns the not found signal when the top score is below the threshold", async () => {
    // The query shares no vocabulary term with any document, so cosine is 0,
    // which is below any positive grounding threshold.
    const config: RetrievalConfig = {
      source: "vector",
      topK: 2,
      groundingThreshold: 0.5,
    };
    const out = await retrieveFor({ retrieval: config }, "quarterly holiday schedule", deps);
    expect(out).not.toBe(null);
    expect(out!.notFound).toBe(true);
    expect(out!.grounded).toBe(false);
    expect(out!.context).toBe("");
    expect(out!.reason).toBeTruthy();
  });

  it("packs a token budget derived from chunking size and topK", async () => {
    // A tiny chunk size forces the budget low enough to truncate the context.
    const config: RetrievalConfig = {
      source: "bm25",
      topK: 2,
      chunking: { size: 2, overlap: 0 },
      groundingThreshold: 0,
    };
    const out = await retrieveFor({ retrieval: config }, "refund policy invoice billing", deps);
    expect(out).not.toBe(null);
    expect(out!.grounded).toBe(true);
    // Budget is size (2) * topK (2) = 4 words, so the packed context is short.
    expect(out!.context.split(/\s+/).length).toBeLessThanOrEqual(4);
  });
});
