import { describe, expect, it, vi } from "vitest";
import { llmJudgeCheck } from "../src/judgeCheck";
import { runEval } from "../src/runner";
import type { EvalCase, EvalDataset } from "../src/types";

const emptyCase: EvalCase<string, undefined> = { id: "x", input: "q" };

describe("llmJudgeCheck wrapping the inference judge", () => {
  it("passes when the mocked judge model votes pass", async () => {
    const seen: string[] = [];
    const modelCall = vi.fn(async (req: { system?: string; user: string }) => {
      seen.push(req.user);
      return '{"pass": true, "reason": "accurate"}';
    });
    const check = llmJudgeCheck<string, undefined, string>({
      modelCall,
      criteria: "Grade whether the answer is accurate.",
    });
    const outcome = await check("the answer", emptyCase);
    expect(outcome.pass).toBe(true);
    expect(outcome.label).toBe("positive");
    // The injected model call actually ran through the inference panel.
    expect(modelCall).toHaveBeenCalledTimes(1);
    // Inference frames the answer as delimited data in the user prompt.
    expect(seen[0]).toContain("the answer");
  });

  it("fails when the mocked judge model votes fail", async () => {
    const check = llmJudgeCheck<string, undefined, string>({
      modelCall: async () => '{"pass": false, "reason": "hallucinated a figure"}',
      criteria: "Grade whether the answer is accurate.",
    });
    const outcome = await check("bogus", emptyCase);
    expect(outcome.pass).toBe(false);
    expect(outcome.label).toBe("negative");
    expect(outcome.rationale).toContain("hallucinated");
  });

  it("drives a full runEval and aggregates judged results", async () => {
    // The judge approves answers that contain "grounded", rejects the rest.
    const modelCall = async ({ user }: { user: string }) =>
      user.includes("grounded")
        ? '{"pass": true, "reason": "cites sources"}'
        : '{"pass": false, "reason": "no grounding"}';

    const dataset: EvalDataset<string, undefined> = {
      name: "grounding",
      cases: [
        { id: "1", input: "explain refunds" },
        { id: "2", input: "explain audits" },
        { id: "3", input: "explain fees" },
      ],
    };
    const good = new Set(["explain refunds", "explain fees"]);

    const run = await runEval({
      dataset,
      generate: (q) => (good.has(q) ? "grounded answer" : "vague answer"),
      check: llmJudgeCheck<string, undefined, string>({
        modelCall,
        criteria: "Grade whether the answer is grounded.",
      }),
    });

    expect(run.total).toBe(3);
    expect(run.passed).toBe(2);
    expect(run.results.filter((r) => r.pass).map((r) => r.caseId)).toEqual(["1", "3"]);
  });
});
