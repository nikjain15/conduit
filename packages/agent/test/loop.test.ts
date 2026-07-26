import { describe, it, expect } from "vitest";
import { runAgent, type CallModel, type Tool } from "../src/index";

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

const writeRecord: Tool = {
  name: "write_record",
  description: "Persist a value (side-effecting).",
  jsonSchema: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
  sideEffecting: true,
  async handler(args) {
    return { written: (args as { value: string }).value };
  },
};

describe("runAgent loop", () => {
  it("terminates on a final answer and records the trace", async () => {
    let step = 0;
    const callModel: CallModel = async () => {
      step++;
      if (step === 1) return { toolCall: { name: "lookup", args: { key: "sky" } } };
      return { finalAnswer: "the sky fact was retrieved" };
    };

    const res = await runAgent({ goal: "get the sky fact", tools: [lookup], callModel, maxSteps: 5 });

    expect(res.answer).toBe("the sky fact was retrieved");
    expect(res.stoppedAtCap).toBe(false);
    // One successful tool call, then a final answer: two recorded steps.
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0]).toMatchObject({ kind: "tool_call", tool: "lookup", ok: true, result: { value: "fact:sky" } });
    expect(res.steps[1]).toMatchObject({ kind: "final", answer: "the sky fact was retrieved" });
  });

  it("respects maxSteps when the model never finishes", async () => {
    let calls = 0;
    // Never returns a final answer: always proposes another read-only tool call.
    const callModel: CallModel = async () => {
      calls++;
      return { toolCall: { name: "lookup", args: { key: `k${calls}` } } };
    };

    const res = await runAgent({ goal: "loop forever", tools: [lookup], callModel, maxSteps: 3 });

    expect(res.answer).toBeUndefined();
    expect(res.stoppedAtCap).toBe(true);
    expect(res.steps).toHaveLength(3);
    expect(calls).toBe(3); // exactly maxSteps model turns, no more.
  });

  it("turns invalid tool args into an error observation, not a throw", async () => {
    let step = 0;
    const callModel: CallModel = async () => {
      step++;
      // First propose args that violate the schema (key must be a non-empty string).
      if (step === 1) return { toolCall: { name: "lookup", args: { key: 123 } } };
      return { finalAnswer: "done" };
    };

    const res = await runAgent({ goal: "bad args", tools: [lookup], callModel, maxSteps: 5 });

    expect(res.answer).toBe("done");
    const errStep = res.steps[0];
    expect(errStep.kind).toBe("tool_error");
    if (errStep.kind === "tool_error") {
      expect(errStep.error.kind).toBe("invalid_args");
      expect(errStep.error.validation && errStep.error.validation.length).toBeGreaterThan(0);
    }
  });

  it("surfaces a handler throw as a structured error observation", async () => {
    const throwing: Tool = {
      name: "boom",
      description: "Always throws.",
      jsonSchema: { type: "object", properties: {}, additionalProperties: true },
      async handler() {
        throw new Error("kaboom");
      },
    };
    let step = 0;
    const callModel: CallModel = async () => {
      step++;
      if (step === 1) return { toolCall: { name: "boom", args: {} } };
      return { finalAnswer: "recovered" };
    };

    const res = await runAgent({ goal: "handle throw", tools: [throwing], callModel, maxSteps: 5 });
    expect(res.answer).toBe("recovered");
    expect(res.steps[0]).toMatchObject({ kind: "tool_error", error: { kind: "handler_error", message: "kaboom" } });
  });

  it("records an unknown-tool call as an error observation", async () => {
    let step = 0;
    const callModel: CallModel = async () => {
      step++;
      if (step === 1) return { toolCall: { name: "ghost", args: {} } };
      return { finalAnswer: "ok" };
    };
    const res = await runAgent({ goal: "unknown tool", tools: [lookup], callModel, maxSteps: 5 });
    expect(res.steps[0]).toMatchObject({ kind: "tool_error", error: { kind: "unknown_tool" } });
  });

  describe("no-authority invariant", () => {
    it("refuses a side-effecting tool by default", async () => {
      let step = 0;
      const callModel: CallModel = async () => {
        step++;
        if (step === 1) return { toolCall: { name: "write_record", args: { value: "x" } } };
        return { finalAnswer: "stopped" };
      };
      const res = await runAgent({ goal: "write", tools: [writeRecord], callModel, maxSteps: 5 });
      expect(res.steps[0]).toMatchObject({ kind: "tool_error", error: { kind: "side_effect_refused" } });
      // The handler must not have run: no successful tool_call step exists.
      expect(res.steps.some((s) => s.kind === "tool_call")).toBe(false);
    });

    it("allows a side-effecting tool when allowSideEffects is set", async () => {
      let step = 0;
      const callModel: CallModel = async () => {
        step++;
        if (step === 1) return { toolCall: { name: "write_record", args: { value: "x" } } };
        return { finalAnswer: "written" };
      };
      const res = await runAgent({
        goal: "write",
        tools: [writeRecord],
        callModel,
        maxSteps: 5,
        allowSideEffects: true,
      });
      expect(res.steps[0]).toMatchObject({ kind: "tool_call", ok: true, result: { written: "x" } });
    });
  });
});
