import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_STEPS,
  SKILL_NAMES,
  TOOL_NAMES,
  getSkill,
  getTool,
  resolveAgent,
  runConfiguredAgent,
} from "../src/agent.ts";
import { skillRegistry, toolRegistry } from "../src/registry.ts";
import type { CallModel, ModelTurn } from "@conduit/agent";
import type { AgentConfig } from "../src/types.ts";

describe("tool and skill registries", () => {
  it("register the sample read only tools on import", () => {
    for (const name of TOOL_NAMES) {
      expect(toolRegistry.has(name)).toBe(true);
      const tool = getTool(name)!;
      expect(tool.name).toBe(name);
      expect(tool.jsonSchema.type).toBe("object");
    }
    // Exactly one sample tool is side effecting; the rest are read only.
    const sideEffecting = TOOL_NAMES.filter((n) => getTool(n)!.sideEffecting === true);
    expect(sideEffecting).toEqual(["post-review-comment"]);
  });

  it("register the sample skills on import", () => {
    for (const id of SKILL_NAMES) {
      expect(skillRegistry.has(id)).toBe(true);
      const skill = getSkill(id)!;
      expect(skill.id).toBe(id);
      expect(typeof skill.whenIntent).toBe("function");
      expect(skill.instructions.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveAgent", () => {
  it("maps every name to its registered item", () => {
    const agent: AgentConfig = {
      mode: "loop",
      tools: ["read-diff", "run-linter"],
      skills: ["review-checklist"],
      maxSteps: 4,
    };
    const resolved = resolveAgent(agent);
    expect(resolved.mode).toBe("loop");
    expect(resolved.maxSteps).toBe(4);
    expect(resolved.tools.map((t) => t.name)).toEqual(["read-diff", "run-linter"]);
    expect(resolved.skills.map((s) => s.id)).toEqual(["review-checklist"]);
    expect(resolved.warnings).toEqual([]);
  });

  it("drops an unknown tool or skill name and records a warning instead of throwing", () => {
    const agent: AgentConfig = {
      mode: "loop",
      tools: ["read-diff", "no-such-tool"],
      skills: ["review-checklist", "no-such-skill"],
    };
    const resolved = resolveAgent(agent);
    expect(resolved.tools.map((t) => t.name)).toEqual(["read-diff"]);
    expect(resolved.skills.map((s) => s.id)).toEqual(["review-checklist"]);
    expect(resolved.warnings).toHaveLength(2);
    expect(resolved.warnings.some((w) => w.includes("no-such-tool"))).toBe(true);
    expect(resolved.warnings.some((w) => w.includes("no-such-skill"))).toBe(true);
  });

  it("resolves a missing agent config to an empty single shot agent with the default cap", () => {
    const resolved = resolveAgent(undefined);
    expect(resolved.mode).toBe("single");
    expect(resolved.tools).toEqual([]);
    expect(resolved.skills).toEqual([]);
    expect(resolved.maxSteps).toBe(DEFAULT_MAX_STEPS);
  });
});

describe("runConfiguredAgent", () => {
  it("runs a real loop in loop mode: calls a tool then finishes", async () => {
    let turn = 0;
    const calls: string[] = [];
    const callModel: CallModel = async (input) => {
      calls.push(input.system);
      turn += 1;
      const next: ModelTurn =
        turn === 1
          ? { toolCall: { name: "search-repo", args: { query: "TODO" } } }
          : { finalAnswer: "done" };
      return next;
    };

    const profile = {
      agent: { mode: "loop", tools: ["search-repo"], skills: [], maxSteps: 5 } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "review the repo", { callModel });

    expect(result.mode).toBe("loop");
    expect(result.answer).toBe("done");
    expect(result.stoppedAtCap).toBe(false);
    const toolStep = result.steps.find((s) => s.kind === "tool_call");
    expect(toolStep && toolStep.kind === "tool_call" && toolStep.tool).toBe("search-repo");
    expect(turn).toBe(2);
  });

  it("makes exactly one model call in single mode with no tool loop", async () => {
    let calls = 0;
    const callModel: CallModel = async () => {
      calls += 1;
      return { finalAnswer: "classified" };
    };
    const profile = {
      agent: { mode: "single", tools: ["classify-intent"], skills: [] } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "triage this ticket", { callModel });

    expect(result.mode).toBe("single");
    expect(result.answer).toBe("classified");
    expect(calls).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].kind).toBe("final");
  });

  it("refuses a side effecting tool by default in loop mode", async () => {
    let turn = 0;
    const callModel: CallModel = async () => {
      turn += 1;
      return turn === 1
        ? { toolCall: { name: "post-review-comment", args: { path: "a.ts", body: "nit" } } }
        : { finalAnswer: "stopped" };
    };
    const profile = {
      agent: { mode: "loop", tools: ["post-review-comment"], skills: [], maxSteps: 3 } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "review the pr", { callModel });

    const refused = result.steps.find(
      (s) => s.kind === "tool_error" && s.error.kind === "side_effect_refused",
    );
    expect(refused).toBeTruthy();
  });

  it("runs a side effecting tool when explicitly allowed", async () => {
    let turn = 0;
    const callModel: CallModel = async () => {
      turn += 1;
      return turn === 1
        ? { toolCall: { name: "post-review-comment", args: { path: "a.ts", body: "nit" } } }
        : { finalAnswer: "posted" };
    };
    const profile = {
      agent: { mode: "loop", tools: ["post-review-comment"], skills: [], maxSteps: 3 } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "review the pr", {
      callModel,
      allowSideEffects: true,
    });

    const ran = result.steps.find((s) => s.kind === "tool_call" && s.tool === "post-review-comment");
    expect(ran).toBeTruthy();
    expect(result.answer).toBe("posted");
  });

  it("injects matching skill instructions into the single mode system prompt", async () => {
    let seenSystem = "";
    const callModel: CallModel = async (input) => {
      seenSystem = input.system;
      return { finalAnswer: "ok" };
    };
    const profile = {
      agent: { mode: "single", tools: [], skills: ["review-checklist"] } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "review this diff", { callModel });

    expect(result.loadedSkills).toEqual(["review-checklist"]);
    expect(seenSystem).toContain("[skill:review-checklist]");
    expect(seenSystem).toContain("review checklist");
  });

  it("does not inject a skill whose intent predicate does not match", async () => {
    let seenSystem = "";
    const callModel: CallModel = async (input) => {
      seenSystem = input.system;
      return { finalAnswer: "ok" };
    };
    const profile = {
      agent: { mode: "single", tools: [], skills: ["review-checklist"] } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "summarize the invoice", { callModel });

    expect(result.loadedSkills).toEqual([]);
    expect(seenSystem).not.toContain("[skill:review-checklist]");
  });

  it("carries resolution warnings through a run", async () => {
    const callModel: CallModel = async () => ({ finalAnswer: "ok" });
    const profile = {
      agent: { mode: "single", tools: ["ghost-tool"], skills: [] } as AgentConfig,
    };
    const result = await runConfiguredAgent(profile, "do a thing", { callModel });
    expect(result.warnings.some((w) => w.includes("ghost-tool"))).toBe(true);
  });
});
