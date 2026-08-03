import { describe, it, expect } from "vitest";
import {
  computeCost,
  computeCostUsd,
  DEFAULT_PRICES,
  UNPRICED_FALLBACK,
} from "../src/core";

/**
 * Cost math, and specifically the unknown-model case.
 *
 * The defect this covers was live and silent. `computeCostUsd` did
 * `if (!p) return 0` for a model with no row in the price table, so a call on an
 * unlisted model was recorded as costing nothing. That is reachable: DEFAULT_PRICES
 * lists Haiku, Sonnet 4.6 and the free Workers-AI model, callers may pass any model
 * through `pinModel`, and admin config can rewrite the table at runtime.
 *
 * The failure mode is the dangerous direction. The cost KPIs would read healthy at
 * exactly the moment an expensive unknown tier was introduced, because the more
 * unfamiliar the model, the more certainly it was billed at zero.
 *
 * Zero is never a safe default for a spend figure. An over-estimate gets
 * investigated; an under-estimate gets trusted.
 */

const M = 1_000_000;
const usage = { inputTokens: M, outputTokens: M };

describe("computeCostUsd · known models", () => {
  it("prices Haiku from the table", () => {
    expect(computeCostUsd("claude-haiku-4-5", usage, DEFAULT_PRICES)).toBeCloseTo(1 + 5, 6);
  });

  it("prices Sonnet from the table", () => {
    expect(computeCostUsd("claude-sonnet-4-6", usage, DEFAULT_PRICES)).toBeCloseTo(3 + 15, 6);
  });

  it("keeps a genuinely free model at zero", () => {
    // Workers-AI is free tier. Zero here is a real price, not a missing one, and
    // the flag is what tells the two apart.
    const r = computeCost("@cf/meta/llama-3.3-70b-instruct-fp8-fast", usage, DEFAULT_PRICES);
    expect(r.usd).toBe(0);
    expect(r.unpriced).toBe(false);
  });
});

describe("computeCostUsd · unknown models are never free", () => {
  it("does NOT return zero for a model with no price row", () => {
    // The regression test. This is the exact shape of the old bug.
    const cost = computeCostUsd("claude-opus-4-8", usage, DEFAULT_PRICES);
    expect(cost).toBeGreaterThan(0);
  });

  it("bills an unknown model at the documented fallback rate", () => {
    const expected = UNPRICED_FALLBACK.inputPerMTok + UNPRICED_FALLBACK.outputPerMTok;
    expect(computeCostUsd("some-future-model", usage, DEFAULT_PRICES)).toBeCloseTo(expected, 6);
  });

  it("flags the estimate so a caller can tell it from a measurement", () => {
    expect(computeCost("some-future-model", usage, DEFAULT_PRICES).unpriced).toBe(true);
    expect(computeCost("claude-haiku-4-5", usage, DEFAULT_PRICES).unpriced).toBe(false);
  });

  it("errs high, not low: the fallback is at least the priciest known tier", () => {
    // An unknown model is more likely a new frontier tier than a new free one.
    // If a pricier model is ever added to DEFAULT_PRICES, this fails and the
    // fallback must be raised with it.
    const dearest = Math.max(
      ...Object.values(DEFAULT_PRICES).map((p) => p.inputPerMTok + p.outputPerMTok),
    );
    const fallback = UNPRICED_FALLBACK.inputPerMTok + UNPRICED_FALLBACK.outputPerMTok;
    expect(fallback).toBeGreaterThanOrEqual(dearest);
  });

  it("still returns zero for zero usage, whatever the model", () => {
    const empty = { inputTokens: 0, outputTokens: 0 };
    expect(computeCostUsd("some-future-model", empty, DEFAULT_PRICES)).toBe(0);
  });

  it("treats missing usage fields as zero rather than NaN", () => {
    expect(computeCostUsd("some-future-model", {}, DEFAULT_PRICES)).toBe(0);
  });
});

describe("the committed price table", () => {
  it("matches the published Anthropic rates", () => {
    // Rally and FounderFirst both shipped Opus at $15/$75, which is Opus-3-era
    // pricing, and it fed their live cost meters. Pinning the rows here means a
    // stale price fails a build instead of quietly tripling a KPI.
    expect(DEFAULT_PRICES["claude-haiku-4-5"]).toEqual({ inputPerMTok: 1.0, outputPerMTok: 5.0 });
    expect(DEFAULT_PRICES["claude-sonnet-4-6"]).toEqual({ inputPerMTok: 3.0, outputPerMTok: 15.0 });
  });
});
