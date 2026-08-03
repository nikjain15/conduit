/**
 * The stop conditions: the three bounds that end a run besides the model
 * deciding it is done.
 *
 * Two halves. The first exercises the pure functions in stop.ts directly. The
 * second drives `runAgent` with a model that misbehaves in a specific way and
 * asserts the loop actually halts, because a budget that is computed and never
 * consulted is the failure this file is here to make impossible.
 */
import { describe, it, expect } from "vitest";
import {
  ZERO_SPEND,
  addUsage,
  budgetBreach,
  budgetGaps,
  runAgent,
  stateKey,
  stopNotice,
  totalTokens,
  type CallModel,
  type Spend,
  type Tool,
} from "../src/index";

const lookup: Tool = {
  name: "lookup",
  description: "Return a canned fact for a key.",
  jsonSchema: {
    type: "object",
    properties: { key: { type: "string", minLength: 1 } },
    required: ["key"],
    additionalProperties: false,
  },
  async handler(args) {
    return { value: `fact:${(args as { key: string }).key}` };
  },
};

describe("spend accounting", () => {
  it("sums tokens and cost across turns", () => {
    let s: Spend = ZERO_SPEND;
    s = addUsage(s, { inputTokens: 100, outputTokens: 20, costUsd: 0.001 });
    s = addUsage(s, { inputTokens: 150, outputTokens: 30, costUsd: 0.002 });
    expect(totalTokens(s)).toBe(300);
    expect(s.costUsd).toBeCloseTo(0.003, 10);
    expect(s.unmeasuredTurns).toBe(0);
  });

  it("counts a turn that reported nothing, rather than treating it as free", () => {
    // The distinction that matters: 0 tokens measured and "we did not look" are
    // not the same claim, and only one of them means the budget is real.
    let s: Spend = ZERO_SPEND;
    s = addUsage(s, undefined);
    s = addUsage(s, {});
    expect(s.unmeasuredTurns).toBe(2);
    expect(totalTokens(s)).toBe(0);
  });
});

describe("budgetBreach", () => {
  const spend = (t: number, usd: number): Spend => ({
    inputTokens: t,
    outputTokens: 0,
    costUsd: usd,
    unmeasuredTurns: 0,
  });

  it("is null with no budget, however much was spent", () => {
    expect(budgetBreach(spend(1e9, 1e6), undefined)).toBeNull();
  });

  it("trips at the token ceiling, inclusive", () => {
    expect(budgetBreach(spend(999, 0), { maxTokens: 1000 })).toBeNull();
    expect(budgetBreach(spend(1000, 0), { maxTokens: 1000 })).toContain("token budget");
  });

  it("trips at the cost ceiling, inclusive", () => {
    expect(budgetBreach(spend(0, 0.049), { maxCostUsd: 0.05 })).toBeNull();
    expect(budgetBreach(spend(0, 0.05), { maxCostUsd: 0.05 })).toContain("cost budget");
  });

  it("reports the number and the ceiling, so the message can be shown as-is", () => {
    expect(budgetBreach(spend(1500, 0), { maxTokens: 1000 })).toBe(
      "token budget: 1500 of 1000 tokens used",
    );
  });
});

describe("budgetGaps: a ceiling that cannot trip is not a ceiling", () => {
  it("is empty when every turn was measured", () => {
    const s: Spend = { inputTokens: 10, outputTokens: 5, costUsd: 0.001, unmeasuredTurns: 0 };
    expect(budgetGaps(s, { maxTokens: 100, maxCostUsd: 1 })).toEqual([]);
  });

  it("is empty when no budget was declared, because nothing was promised", () => {
    const s: Spend = { inputTokens: 0, outputTokens: 0, costUsd: 0, unmeasuredTurns: 3 };
    expect(budgetGaps(s, undefined)).toEqual([]);
  });

  it("flags a USD budget that no turn ever reported a cost for", () => {
    const s: Spend = { inputTokens: 500, outputTokens: 100, costUsd: 0, unmeasuredTurns: 0 };
    const gaps = budgetGaps(s, { maxCostUsd: 0.5 });
    expect(gaps.join(" ")).toContain("cost ceiling cannot trip");
  });

  it("flags turns the budget never saw", () => {
    const s: Spend = { inputTokens: 10, outputTokens: 0, costUsd: 0.1, unmeasuredTurns: 2 };
    expect(budgetGaps(s, { maxTokens: 100 })[0]).toContain("2 model turn(s) reported no usage");
  });
});

describe("stateKey", () => {
  it("is insensitive to key order in both args and result", () => {
    expect(stateKey("t", { a: 1, b: 2 }, { x: 1, y: 2 })).toBe(
      stateKey("t", { b: 2, a: 1 }, { y: 2, x: 1 }),
    );
  });

  it("separates the same call with a different result, the poller case", () => {
    // This is why the result is part of the state. A tool that legitimately
    // returns something new must not be treated as a loop.
    expect(stateKey("poll", { id: 1 }, { status: "pending" })).not.toBe(
      stateKey("poll", { id: 1 }, { status: "done" }),
    );
  });

  it("separates different tools with identical arguments and results", () => {
    expect(stateKey("a", { k: 1 }, { v: 1 })).not.toBe(stateKey("b", { k: 1 }, { v: 1 }));
  });

  it("does not throw on a circular result", () => {
    const circular: Record<string, unknown> = { name: "x" };
    circular.self = circular;
    expect(() => stateKey("t", {}, circular)).not.toThrow();
  });
});

describe("stopNotice", () => {
  it("is empty for a final answer, because the answer is what the user sees", () => {
    expect(stopNotice("final_answer", "", 3)).toBe("");
  });

  it("says how far the run got for every bound", () => {
    for (const reason of ["max_steps", "budget_exhausted", "loop_detected"] as const) {
      expect(stopNotice(reason, "detail", 4)).toContain("Here is how far I got: 4 steps");
    }
  });

  it("singularises one step", () => {
    expect(stopNotice("max_steps", "1 step", 1)).toContain("1 step completed");
  });
});

describe("runAgent stop conditions end a real run", () => {
  it("halts on the token budget before the step cap", async () => {
    let calls = 0;
    // Never finishes, and every call is distinct so loop detection cannot be
    // what stops it. Only the budget can.
    const callModel: CallModel = async () => {
      calls++;
      return {
        toolCall: { name: "lookup", args: { key: `k${calls}` } },
        usage: { inputTokens: 400, outputTokens: 100 },
      };
    };

    const res = await runAgent({
      goal: "spend forever",
      tools: [lookup],
      callModel,
      maxSteps: 50,
      budget: { maxTokens: 1500 },
    });

    expect(res.stopReason).toBe("budget_exhausted");
    expect(res.stoppedAtCap).toBe(false);
    expect(res.answer).toBeUndefined();
    // 500 tokens a turn, ceiling 1500: charged after the third turn, stopped there.
    expect(calls).toBe(3);
    expect(totalTokens(res.spend)).toBe(1500);
    expect(res.notice).toContain("token budget");
    expect(res.notice).toContain("Here is how far I got");
    expect(res.budgetEnforceable).toEqual([]);
  });

  it("halts on the cost budget", async () => {
    let calls = 0;
    const callModel: CallModel = async () => {
      calls++;
      return {
        toolCall: { name: "lookup", args: { key: `k${calls}` } },
        usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.02 },
      };
    };

    const res = await runAgent({
      goal: "spend money",
      tools: [lookup],
      callModel,
      maxSteps: 50,
      budget: { maxCostUsd: 0.05 },
    });

    expect(res.stopReason).toBe("budget_exhausted");
    expect(res.notice).toContain("cost budget");
    expect(calls).toBe(3); // 0.02, 0.04, 0.06 -> trips on the third
    expect(res.spend.costUsd).toBeCloseTo(0.06, 10);
  });

  it("reports a USD budget it could never have enforced", async () => {
    // The dishonest-safety case: a caller sets a dollar ceiling against a
    // callModel that reports tokens only. The run must not claim it was bounded.
    let calls = 0;
    const callModel: CallModel = async () => {
      calls++;
      if (calls > 3) return { finalAnswer: "done" };
      return {
        toolCall: { name: "lookup", args: { key: `k${calls}` } },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    };

    const res = await runAgent({
      goal: "unpriced",
      tools: [lookup],
      callModel,
      maxSteps: 10,
      budget: { maxCostUsd: 0.5 },
    });

    expect(res.stopReason).toBe("final_answer");
    expect(res.budgetEnforceable.join(" ")).toContain("cost ceiling cannot trip");
  });

  it("halts when a call returns an identical result a second time", async () => {
    let calls = 0;
    // The classic stuck agent: it keeps asking the same question.
    const callModel: CallModel = async () => {
      calls++;
      return { toolCall: { name: "lookup", args: { key: "sky" } } };
    };

    const res = await runAgent({ goal: "go in circles", tools: [lookup], callModel, maxSteps: 20 });

    expect(res.stopReason).toBe("loop_detected");
    expect(res.answer).toBeUndefined();
    expect(calls).toBe(2); // caught on the repeat, not at step 20
    expect(res.notice).toContain("repeated itself");
    expect(res.notice).toContain("Here is how far I got: 2 steps");
  });

  it("does NOT halt a tool whose identical call returns something new", async () => {
    // A poller. Same tool, same arguments, moving result: legitimate, and the
    // reason `stateKey` includes the result.
    let polls = 0;
    const poll: Tool = {
      name: "poll",
      description: "Poll a job.",
      jsonSchema: { type: "object", properties: {}, additionalProperties: true },
      async handler() {
        polls++;
        return { status: polls < 3 ? "pending" : "done", tick: polls };
      },
    };

    let calls = 0;
    const callModel: CallModel = async () => {
      calls++;
      if (calls > 3) return { finalAnswer: `settled after ${polls} polls` };
      return { toolCall: { name: "poll", args: {} } };
    };

    const res = await runAgent({ goal: "wait for the job", tools: [poll], callModel, maxSteps: 20 });

    expect(res.stopReason).toBe("final_answer");
    expect(res.answer).toBe("settled after 3 polls");
  });

  it("does not treat a repeated ERROR as a loop, because the error is the new information", async () => {
    let calls = 0;
    const callModel: CallModel = async () => {
      calls++;
      // Twice invalid (missing `key`), then it learns and answers.
      if (calls <= 2) return { toolCall: { name: "lookup", args: {} } };
      return { finalAnswer: "recovered" };
    };

    const res = await runAgent({ goal: "recover", tools: [lookup], callModel, maxSteps: 10 });

    expect(res.stopReason).toBe("final_answer");
    expect(res.answer).toBe("recovered");
  });

  it("can be turned off, and then only the step cap catches the loop", async () => {
    const callModel: CallModel = async () => ({ toolCall: { name: "lookup", args: { key: "sky" } } });

    const res = await runAgent({
      goal: "go in circles unbounded",
      tools: [lookup],
      callModel,
      maxSteps: 4,
      detectLoops: false,
    });

    expect(res.stopReason).toBe("max_steps");
    expect(res.stoppedAtCap).toBe(true);
    expect(res.steps).toHaveLength(4);
  });

  it("still reports stopReason final_answer and an empty notice on the happy path", async () => {
    const callModel: CallModel = async () => ({ finalAnswer: "here you go" });
    const res = await runAgent({ goal: "easy", tools: [lookup], callModel, maxSteps: 5 });
    expect(res.stopReason).toBe("final_answer");
    expect(res.notice).toBe("");
    expect(res.spend.unmeasuredTurns).toBe(1); // this mock reports no usage, and that is recorded
  });
});
