/**
 * Per use case agent, driven by named tool and skill registries.
 *
 * The profile only names its capabilities by string (agent.tools, agent.skills)
 * and picks a shape (agent.mode, agent.maxSteps). This module fills the shared
 * `toolRegistry` and `skillRegistry` with concrete read only sample tools and
 * intent selected skills, then adds a resolver plus a one call runner. Executors
 * stay free of tool and skill specifics: they read a profile and call
 * `runConfiguredAgent`.
 *
 * No authority invariant, preserved end to end: a tool marked `sideEffecting` is
 * refused unless the run is invoked with `allowSideEffects: true`. In loop mode
 * `@conduit/agent`'s `runAgent` enforces the refusal and feeds it back as an
 * observation; single mode runs no tools at all, so nothing side effecting can
 * fire. Unknown tool or skill names never throw: they are dropped and recorded
 * as warnings on the resolved config.
 */

import { ZERO_SPEND, addUsage, runAgent, selectSkills } from "@conduit/agent";
import type {
  CallModel,
  RunBudget,
  Skill,
  Spend,
  StepRecord,
  StopReason,
  Tool,
} from "@conduit/agent";
import type { ChatMessage } from "@conduit/inference";

import { skillRegistry, toolRegistry } from "./registry.ts";
import type { AgentConfig } from "./types.ts";

/**
 * The sample tools registered on import. Every one is read only: it inspects
 * supplied inputs and returns a deterministic result with no external effect and
 * no network. The single side effecting sample (`post-review-comment`) exists so
 * the no authority invariant has something concrete to refuse. Handlers are
 * intentionally simple: they demonstrate the shape, not a real integration.
 */

const readDiff: Tool = {
  name: "read-diff",
  description: "Read the unified diff for a pull request or a specific file path.",
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: [],
  },
  async handler(args) {
    const path = typeof args.path === "string" ? args.path : "(whole change set)";
    return { path, hunks: 0, summary: `no local diff available for ${path}` };
  },
};

const runLinter: Tool = {
  name: "run-linter",
  description: "Run the configured linter over a file path and return its findings.",
  jsonSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
  async handler(args) {
    return { path: args.path, findings: [] as string[], clean: true };
  },
};

const searchRepo: Tool = {
  name: "search-repo",
  description: "Search the repository for a query string and return matching locations.",
  jsonSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "number" },
    },
    required: ["query"],
  },
  async handler(args) {
    const limit = typeof args.limit === "number" ? args.limit : 10;
    return { query: args.query, limit, matches: [] as string[] };
  },
};

const classifyIntent: Tool = {
  name: "classify-intent",
  description: "Classify a customer message into one of a fixed set of support intents.",
  jsonSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  async handler(args) {
    const text = String(args.text ?? "");
    const intent = /refund|charge|invoice|bill/i.test(text) ? "billing" : "general";
    return { intent, confidence: 0.5 };
  },
};

const fetchDoc: Tool = {
  name: "fetch-doc",
  description: "Fetch a knowledge base document by id and return its text.",
  jsonSchema: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"],
  },
  async handler(args) {
    return { id: args.id, found: false, text: "" };
  },
};

const postReviewComment: Tool = {
  name: "post-review-comment",
  description: "Post a review comment on a pull request. Mutates external state.",
  sideEffecting: true,
  jsonSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      body: { type: "string" },
    },
    required: ["path", "body"],
  },
  async handler(args) {
    return { posted: true, path: args.path };
  },
};

/** The tool registry names this module registers. */
export const TOOL_NAMES = [
  "read-diff",
  "run-linter",
  "search-repo",
  "classify-intent",
  "fetch-doc",
  "post-review-comment",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Register the sample tools on import. Re registering a name overwrites it, so
 * importing this module is idempotent.
 */
toolRegistry
  .register("read-diff", readDiff)
  .register("run-linter", runLinter)
  .register("search-repo", searchRepo)
  .register("classify-intent", classifyIntent)
  .register("fetch-doc", fetchDoc)
  .register("post-review-comment", postReviewComment);

/**
 * The sample skills registered on import. Each carries an intent predicate over
 * the run context so it only loads when relevant, and the instructions that get
 * injected into the system prompt when it matches.
 */

const reviewChecklist: Skill = {
  id: "review-checklist",
  whenIntent: (ctx) => /review|diff|pull request|\bpr\b/i.test(ctx.goal),
  instructions:
    "Work through the review checklist: correctness, tests, security, and readability. " +
    "Cite the file and hunk for every finding. Never post a comment without evidence.",
};

const citeSources: Skill = {
  id: "cite-sources",
  whenIntent: (ctx) => /cite|source|according to|reference/i.test(ctx.goal),
  instructions:
    "Ground every claim in a retrieved source and cite it inline. If no source " +
    "supports a claim, say so rather than inventing one.",
};

const triagePriority: Skill = {
  id: "triage-priority",
  whenIntent: (ctx) => /triage|urgent|priority|escalat/i.test(ctx.goal),
  instructions:
    "Assess urgency first. Flag anything that mentions an outage, a security issue, " +
    "or a payment failure as high priority before classifying further.",
};

/** The skill registry ids this module registers. */
export const SKILL_NAMES = [
  "review-checklist",
  "cite-sources",
  "triage-priority",
] as const;
export type SkillName = (typeof SKILL_NAMES)[number];

skillRegistry
  .register("review-checklist", reviewChecklist)
  .register("cite-sources", citeSources)
  .register("triage-priority", triagePriority);

/** Read a tool by name from the shared registry. */
export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name) as Tool | undefined;
}

/** Read a skill by id from the shared registry. */
export function getSkill(name: string): Skill | undefined {
  return skillRegistry.get(name) as Skill | undefined;
}

/** Optional overrides for resolution, mainly for tests. Defaults to the shared
 *  registries so callers pass nothing in practice. */
export interface ResolveAgentDeps {
  tools?: { get(name: string): unknown };
  skills?: { get(name: string): unknown };
}

/** Default step budget for a loop when the profile omits maxSteps. */
export const DEFAULT_MAX_STEPS = 8;

/** An agent config resolved from names to concrete registered items. Unknown
 *  names are dropped and recorded in `warnings` rather than throwing. */
export interface ResolvedAgent {
  mode: "single" | "loop";
  tools: Tool[];
  skills: Skill[];
  maxSteps: number;
  /** Spend ceiling for the run, if the profile declared one. */
  budget?: RunBudget;
  /** Repeated-state halting; undefined leaves the loop's own default (on). */
  detectLoops?: boolean;
  warnings: string[];
}

/**
 * Resolve an agent config, mapping each tool and skill name to its registered
 * item. An unknown name is dropped and recorded as a warning, never thrown. A
 * missing agent config resolves to an empty single shot agent. `maxSteps` falls
 * back to `DEFAULT_MAX_STEPS`.
 */
export function resolveAgent(
  agent: AgentConfig | undefined,
  deps: ResolveAgentDeps = {},
): ResolvedAgent {
  const toolSource = deps.tools ?? toolRegistry;
  const skillSource = deps.skills ?? skillRegistry;
  const warnings: string[] = [];

  if (!agent) {
    return { mode: "single", tools: [], skills: [], maxSteps: DEFAULT_MAX_STEPS, warnings };
  }

  // A budget of all-zeros or negatives would be a ceiling nothing can satisfy,
  // which silently turns every run into an immediate stop. Say so instead.
  if (agent.budget) {
    for (const [field, value] of Object.entries(agent.budget)) {
      if (typeof value === "number" && value <= 0) {
        warnings.push(`agent budget "${field}" is ${value}: a non-positive ceiling stops every run at its first turn`);
      }
    }
  }

  const tools: Tool[] = [];
  for (const name of agent.tools) {
    const tool = toolSource.get(name) as Tool | undefined;
    if (tool) tools.push(tool);
    else warnings.push(`unknown tool "${name}" dropped: not registered in the tool registry`);
  }

  const skills: Skill[] = [];
  for (const name of agent.skills) {
    const skill = skillSource.get(name) as Skill | undefined;
    if (skill) skills.push(skill);
    else warnings.push(`unknown skill "${name}" dropped: not registered in the skill registry`);
  }

  return {
    mode: agent.mode,
    tools,
    skills,
    maxSteps: agent.maxSteps ?? DEFAULT_MAX_STEPS,
    budget: agent.budget,
    detectLoops: agent.detectLoops,
    warnings,
  };
}

/** Everything the runner needs that does not live on the profile. */
export interface RunAgentDeps extends ResolveAgentDeps {
  /** Injected model call, compatible with `@conduit/agent` and `@conduit/inference`. */
  callModel: CallModel;
  /** Base system prompt. A sensible default is used when absent. */
  system?: string;
  /** Extra run context passed to skill intent predicates. */
  context?: string;
  /** No authority override: side effecting tools only run when this is true. */
  allowSideEffects?: boolean;
}

/** The outcome of a configured run, uniform across single and loop mode. */
export interface RunConfiguredResult {
  mode: "single" | "loop";
  /** The final answer, or undefined if a loop hit its step cap first. */
  answer?: string;
  /** Ordered trace of loop steps. Empty for single mode. */
  steps: StepRecord[];
  /** True when a loop stopped at maxSteps without a final answer. Exactly
   *  `stopReason === "max_steps"`; prefer `stopReason`. */
  stoppedAtCap: boolean;
  /** Which termination ended the run. Always "final_answer" in single mode. */
  stopReason: StopReason;
  /**
   * What to show the user when a bound tripped, empty otherwise. This is the
   * user-visible half of the stop conditions: a run that halts on a budget or a
   * detected loop returns its partial trace plus this line, rather than an
   * empty answer the caller has to explain on its behalf.
   */
  notice: string;
  /** What the run consumed, as reported by `callModel`. */
  spend: Spend;
  /** Non-empty when a declared budget could not actually have tripped. */
  budgetEnforceable: string[];
  /** The ids of the skills whose instructions were injected this run. */
  loadedSkills: string[];
  /** Warnings from resolving names to registered items (dropped unknowns). */
  warnings: string[];
}

const DEFAULT_SYSTEM =
  "You are a Conduit agent. Work toward the goal using the tools and skills your " +
  "use case profile allows. Do not invent tool results.";

/** Compose the base prompt with the goal and any active skill instructions. This
 *  mirrors the loop's own injection so single mode gets the same skill guidance. */
function buildSingleSystemPrompt(base: string, goal: string, skills: Skill[]): string {
  const parts = [base, `\nGoal: ${goal}`];
  if (skills.length > 0) {
    parts.push("\nActive skills:");
    for (const skill of skills) parts.push(`\n[skill:${skill.id}]\n${skill.instructions}`);
  }
  return parts.join("\n");
}

/**
 * Resolve a profile's agent config and run it against an input.
 *
 * In `loop` mode this delegates to `@conduit/agent`'s `runAgent` with the
 * resolved tools, skills, and step budget, and the injected `callModel`; the no
 * authority invariant is enforced there. In `single` mode it selects the
 * matching skills, injects their instructions into the system prompt, and makes
 * exactly one model call with no tools advertised and no tool loop. Either way
 * the resolution warnings are carried through so an unknown name is visible.
 */
export async function runConfiguredAgent(
  profile: { agent?: AgentConfig },
  input: string,
  deps: RunAgentDeps,
): Promise<RunConfiguredResult> {
  const resolved = resolveAgent(profile.agent, deps);
  const base = deps.system ?? DEFAULT_SYSTEM;

  if (resolved.mode === "loop") {
    const result = await runAgent({
      goal: input,
      tools: resolved.tools,
      skills: resolved.skills,
      callModel: deps.callModel,
      maxSteps: resolved.maxSteps,
      context: deps.context,
      system: base,
      allowSideEffects: deps.allowSideEffects,
      budget: resolved.budget,
      ...(resolved.detectLoops === undefined ? {} : { detectLoops: resolved.detectLoops }),
    });
    return {
      mode: "loop",
      answer: result.answer,
      steps: result.steps,
      stoppedAtCap: result.stoppedAtCap,
      stopReason: result.stopReason,
      notice: result.notice,
      spend: result.spend,
      budgetEnforceable: result.budgetEnforceable,
      loadedSkills: result.loadedSkills,
      warnings: resolved.warnings,
    };
  }

  // Single shot: pick matching skills, inject them, make one tool free call.
  const matched = selectSkills(resolved.skills, { goal: input, context: deps.context });
  const systemPrompt = buildSingleSystemPrompt(base, input, matched);
  const messages: ChatMessage[] = [{ role: "user", content: input }];
  const turn = await deps.callModel({ system: systemPrompt, messages });

  const steps: StepRecord[] = [];
  if (turn.finalAnswer !== undefined) {
    steps.push({ kind: "final", answer: turn.finalAnswer });
  } else {
    steps.push({ kind: "no_action", note: "single mode expected a final answer" });
  }

  return {
    mode: "single",
    answer: turn.finalAnswer,
    steps,
    stoppedAtCap: false,
    // Single mode makes exactly one call: there is no loop to bound, so no stop
    // condition can trip. The spend is still recorded, because a single call
    // costs money too and a caller aggregating across runs needs the number.
    stopReason: "final_answer",
    notice: "",
    spend: addUsage(ZERO_SPEND, turn.usage),
    budgetEnforceable: [],
    loadedSkills: matched.map((s) => s.id),
    warnings: resolved.warnings,
  };
}
