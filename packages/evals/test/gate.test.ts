import { describe, it, expect } from "vitest";
import { Registry } from "../../profile/src/registry.ts";
import type { EvalBinding } from "../../profile/src/types.ts";
import { registerBuiltInMethods, type CheckMethod } from "../src/methods.ts";
import { runGate, runBatch, type BatchInput } from "../src/gate.ts";
import type { EvalDataset } from "../src/types.ts";

function freshRegistry(): Registry<unknown> {
  return registerBuiltInMethods(new Registry<unknown>("test-method"));
}

describe("runGate", () => {
  it("returns passed when every inline spec passes", async () => {
    const registry = freshRegistry();
    const specs: EvalBinding[] = [
      { key: "no-pii", method: "pii_scan", when: "inline", mandatory: true, floor: true },
      { key: "has-refund", method: "contains", params: { pattern: "refund" }, when: "inline", mandatory: true },
    ];
    const out = await runGate(specs, { answer: "Your refund is on the way." }, { registry });
    expect(out.decision).toBe("passed");
    expect(out.results.every((r) => r.pass)).toBe(true);
  });

  it("blocks when a mandatory floor spec fails", async () => {
    const registry = freshRegistry();
    const specs: EvalBinding[] = [
      { key: "no-pii", method: "pii_scan", when: "inline", mandatory: true, floor: true },
    ];
    const out = await runGate(specs, { answer: "email me at a@b.com" }, { registry });
    expect(out.decision).toBe("blocked");
    expect(out.results[0].pass).toBe(false);
  });

  it("fails closed when a mandatory spec's method is missing", async () => {
    const registry = freshRegistry();
    const specs: EvalBinding[] = [
      { key: "ghost", method: "not_registered", when: "inline", mandatory: true },
    ];
    const out = await runGate(specs, { answer: "anything" }, { registry });
    expect(out.decision).toBe("failed_closed");
    expect(out.results[0].missing).toBe(true);
  });

  it("does not block on a failing non-mandatory, non-floor spec", async () => {
    const registry = freshRegistry();
    const specs: EvalBinding[] = [
      { key: "optional", method: "contains", params: { pattern: "zzz" }, when: "inline" },
    ];
    const out = await runGate(specs, { answer: "no such token here" }, { registry });
    expect(out.results[0].pass).toBe(false);
    expect(out.decision).toBe("passed");
  });

  it("runs only inline specs inline", async () => {
    const registry = freshRegistry();
    let batchRan = false;
    const spy: CheckMethod = () => {
      batchRan = true;
      return { pass: true };
    };
    registry.register("spy", spy);
    const specs: EvalBinding[] = [
      { key: "inline-one", method: "pii_scan", when: "inline", mandatory: true },
      { key: "batch-one", method: "spy", when: "batch", mandatory: true },
    ];
    const out = await runGate(specs, { answer: "clean text" }, { registry });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].key).toBe("inline-one");
    expect(batchRan).toBe(false);
  });
});

describe("runBatch", () => {
  it("aggregates metrics over a dataset using the same specs", async () => {
    const registry = freshRegistry();
    const specs: EvalBinding[] = [
      { key: "no-pii", method: "pii_scan", when: "batch", mandatory: true },
      { key: "inline-skip", method: "contains", params: { pattern: "x" }, when: "inline" },
    ];
    const dataset: EvalDataset<BatchInput, unknown> = {
      name: "answers",
      cases: [
        { id: "1", input: { answer: "all clean here" } },
        { id: "2", input: { answer: "reach me at a@b.com" } },
        { id: "3", input: { answer: "nothing to see" } },
      ],
    };
    const out = await runBatch(specs, dataset, { registry });
    // Only the batch spec produced a metric bundle.
    expect(out.evals).toHaveLength(1);
    const bundle = out.evals[0];
    expect(bundle.key).toBe("no-pii");
    expect(bundle.run.total).toBe(3);
    // Two of three answers are PII-clean (pass), one carries an email (fail).
    expect(bundle.run.passed).toBe(2);
    expect(bundle.metrics.support).toBe(3);
  });
});
