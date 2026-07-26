import { describe, it, expect } from "vitest";
import { runAgent, selectSkills, type CallModel, type Skill } from "../src/index";

const refundSkill: Skill = {
  id: "refund",
  whenIntent: (ctx) => /refund/i.test(ctx.goal),
  instructions: "When handling refunds, confirm the order id before issuing anything.",
};

const shippingSkill: Skill = {
  id: "shipping",
  whenIntent: (ctx) => /ship|deliver/i.test(ctx.goal),
  instructions: "For shipping questions, quote the carrier ETA window.",
};

describe("skill selection", () => {
  it("selectSkills matches by intent, preserving order", () => {
    const matched = selectSkills([refundSkill, shippingSkill], { goal: "process a refund please" });
    expect(matched.map((s) => s.id)).toEqual(["refund"]);
  });

  it("injects matching-skill instructions into the system prompt and omits non-matching ones", async () => {
    let seenSystem = "";
    const callModel: CallModel = async ({ system }) => {
      seenSystem = system;
      return { finalAnswer: "handled" };
    };

    const res = await runAgent({
      goal: "I need a refund on order 42",
      tools: [],
      skills: [refundSkill, shippingSkill],
      callModel,
      maxSteps: 3,
    });

    expect(res.loadedSkills).toEqual(["refund"]);
    expect(seenSystem).toContain("[skill:refund]");
    expect(seenSystem).toContain("confirm the order id");
    // The non-matching skill's guidance must not leak into the prompt.
    expect(seenSystem).not.toContain("[skill:shipping]");
    expect(seenSystem).not.toContain("carrier ETA");
  });

  it("loads no skills when none match the intent", async () => {
    let seenSystem = "";
    const callModel: CallModel = async ({ system }) => {
      seenSystem = system;
      return { finalAnswer: "ok" };
    };
    const res = await runAgent({
      goal: "what is your name",
      tools: [],
      skills: [refundSkill, shippingSkill],
      callModel,
      maxSteps: 3,
    });
    expect(res.loadedSkills).toEqual([]);
    expect(seenSystem).not.toContain("[skill:");
  });
});
