import { describe, it, expect } from "vitest";
import { builtInMethods, builtInMethodNames } from "../src/methods.ts";
import type { JudgeModelCall } from "../src/judgeCheck.ts";

const {
  regex,
  contains,
  json_schema,
  numeric_match,
  pii_scan,
  exact_match,
  groundedness,
  llm_judge,
} = builtInMethods;

describe("built-in method registry", () => {
  it("exposes every named built-in", () => {
    expect(builtInMethodNames).toEqual(
      expect.arrayContaining([
        "regex",
        "contains",
        "json_schema",
        "numeric_match",
        "pii_scan",
        "exact_match",
        "groundedness",
        "llm_judge",
      ]),
    );
  });
});

describe("regex and contains", () => {
  it("regex matches with params.pattern and flags", async () => {
    expect((await regex({ answer: "Ticket URGENT", params: { pattern: "urgent", flags: "i" } })).pass).toBe(true);
    expect((await regex({ answer: "calm", params: { pattern: "urgent", flags: "i" } })).pass).toBe(false);
  });

  it("contains does a case-insensitive substring check by default", async () => {
    expect((await contains({ answer: "Refund issued", params: { pattern: "refund" } })).pass).toBe(true);
    expect((await contains({ answer: "Refund issued", params: { pattern: "refund", caseSensitive: true } })).pass).toBe(false);
  });
});

describe("pii_scan", () => {
  it("flags an email address as PII", async () => {
    const r = await pii_scan({ answer: "Contact me at jane.doe@example.com please" });
    expect(r.pass).toBe(false);
    expect(r.label).toBe("pii_detected");
    expect(r.detail).toContain("email");
  });

  it("passes clean text and labels itself a heuristic", async () => {
    const r = await pii_scan({ answer: "Your order has shipped and will arrive Tuesday." });
    expect(r.pass).toBe(true);
    expect(r.detail).toContain("heuristic");
  });

  it("flags a card-like digit run", async () => {
    const r = await pii_scan({ answer: "card 4111 1111 1111 1111 on file" });
    expect(r.pass).toBe(false);
  });
});

describe("numeric_match", () => {
  it("passes when every expected figure appears (comma/currency tolerant)", async () => {
    const r = await numeric_match({ answer: "Total due is $1,234.50 across 3 items", params: { expected: [1234.5, 3] } });
    expect(r.pass).toBe(true);
  });

  it("fails when an expected figure is missing", async () => {
    const r = await numeric_match({ answer: "Total due is $100", params: { expected: 200 } });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("200");
  });
});

describe("json_schema", () => {
  const schema = {
    type: "object",
    required: ["intent", "urgency"],
    properties: {
      intent: { type: "string", enum: ["billing", "technical"] },
      urgency: { type: "number" },
    },
  };

  it("passes a conforming JSON answer", async () => {
    const r = await json_schema({ answer: JSON.stringify({ intent: "billing", urgency: 2 }), params: { schema } });
    expect(r.pass).toBe(true);
  });

  it("fails a missing required field", async () => {
    const r = await json_schema({ answer: JSON.stringify({ intent: "billing" }), params: { schema } });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain("urgency");
  });

  it("fails when the answer is not valid JSON", async () => {
    const r = await json_schema({ answer: "not json", params: { schema } });
    expect(r.pass).toBe(false);
    expect(r.label).toBe("invalid_json");
  });

  it("fails an enum violation", async () => {
    const r = await json_schema({ answer: JSON.stringify({ intent: "sales", urgency: 1 }), params: { schema } });
    expect(r.pass).toBe(false);
  });
});

describe("exact_match", () => {
  it("passes an exact (trimmed) match and fails a difference", async () => {
    expect((await exact_match({ answer: "  positive ", params: { expected: "positive" } })).pass).toBe(true);
    expect((await exact_match({ answer: "negative", params: { expected: "positive" } })).pass).toBe(false);
  });
});

describe("groundedness", () => {
  it("passes an answer supported by the retrieved context", async () => {
    const r = await groundedness({
      answer: "The refund window is thirty days.",
      retrieved: ["Our refund window is thirty days from purchase."],
    });
    expect(r.pass).toBe(true);
  });

  it("flags an unsupported claim", async () => {
    const r = await groundedness({
      answer: "The rocket reached orbit at dawn.",
      retrieved: ["Our refund window is thirty days from purchase."],
    });
    expect(r.pass).toBe(false);
    expect(r.label).toBe("unsupported");
  });

  it("fails closed when there is no retrieved context", async () => {
    const r = await groundedness({ answer: "Anything at all.", retrieved: [] });
    expect(r.pass).toBe(false);
    expect(r.label).toBe("no_context");
  });
});

describe("llm_judge", () => {
  it("passes when the mocked judge model returns a passing verdict", async () => {
    const modelCall: JudgeModelCall = async () =>
      JSON.stringify({ pass: true, rationale: "clear and correct" });
    const r = await llm_judge({
      answer: "Reset your password from the account settings page.",
      input: "How do I reset my password?",
      params: { criteria: "Answer is correct and actionable." },
      deps: { judgeModelCall: modelCall },
    });
    expect(r.pass).toBe(true);
  });

  it("fails when the mocked judge model returns a failing verdict", async () => {
    const modelCall: JudgeModelCall = async () =>
      JSON.stringify({ pass: false, rationale: "off topic" });
    const r = await llm_judge({
      answer: "The weather is nice.",
      input: "How do I reset my password?",
      params: { criteria: "Answer is correct and actionable." },
      deps: { judgeModelCall: modelCall },
    });
    expect(r.pass).toBe(false);
  });

  it("is misconfigured without an injected model call", async () => {
    const r = await llm_judge({ answer: "x", params: { criteria: "y" } });
    expect(r.pass).toBe(false);
    expect(r.label).toBe("misconfigured");
  });
});
