import { describe, expect, it } from "vitest";
import { exactMatch, predicate } from "../src/checkers";
import { runEval } from "../src/runner";
import type { EvalDataset } from "../src/types";

interface Q {
  prompt: string;
}

describe("runEval with a deterministic checker", () => {
  const dataset: EvalDataset<Q, string> = {
    name: "arithmetic",
    cases: [
      { id: "1", input: { prompt: "2+2" }, expected: "4" },
      { id: "2", input: { prompt: "3+3" }, expected: "6" },
      { id: "3", input: { prompt: "5+5" }, expected: "10" },
      { id: "4", input: { prompt: "9+9" }, expected: "18" },
    ],
  };

  it("aggregates pass/fail across the dataset", async () => {
    // Generator is right on the first three, wrong on the last.
    const answers: Record<string, string> = { "2+2": "4", "3+3": "6", "5+5": "10", "9+9": "17" };
    const run = await runEval({
      dataset,
      generate: (q) => answers[q.prompt],
      check: exactMatch<Q, string>(),
    });

    expect(run.name).toBe("arithmetic");
    expect(run.total).toBe(4);
    expect(run.passed).toBe(3);
    expect(run.passRate).toBeCloseTo(0.75, 10);

    const failing = run.results.find((r) => !r.pass);
    expect(failing?.caseId).toBe("4");
    expect(failing?.label).toBe("negative");
  });

  it("records a generator throw as a failing result without aborting", async () => {
    const run = await runEval({
      dataset,
      generate: (q) => {
        if (q.prompt === "5+5") throw new Error("model blew up");
        return "wrong";
      },
      check: exactMatch<Q, string>(),
    });
    expect(run.total).toBe(4);
    expect(run.passed).toBe(0);
    const blown = run.results.find((r) => r.caseId === "3");
    expect(blown?.pass).toBe(false);
    expect(blown?.rationale).toContain("model blew up");
  });

  it("supports a predicate checker with custom labels", async () => {
    const spamData: EvalDataset<string, "spam" | "ham"> = {
      name: "spam-filter",
      cases: [
        { id: "a", input: "cheap meds now", expected: "spam" },
        { id: "b", input: "lunch tomorrow?", expected: "ham" },
      ],
    };
    const run = await runEval({
      dataset: spamData,
      generate: (text) => (text.includes("meds") ? "spam" : "ham"),
      check: predicate<string, "spam" | "ham", string>(
        (out, c) => out === c.expected,
        (out) => out, // predicted class is the model's label
      ),
    });
    expect(run.passed).toBe(2);
    expect(run.results.map((r) => r.label)).toEqual(["spam", "ham"]);
  });
});
