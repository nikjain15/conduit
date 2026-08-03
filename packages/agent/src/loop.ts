/**
 * runAgent, a bounded reason-act loop.
 *
 * On each step the injected `callModel` sees the system prompt (base + any matched
 * skill instructions), the running transcript, and the advertised tool specs, and
 * proposes EITHER a tool call OR a final answer. A proposed tool call is validated
 * against the tool's input schema and, if side-effecting, gated by the no-authority
 * invariant; the result (or a structured error) becomes an observation appended to
 * the transcript, and the loop iterates. The loop is pure with respect to IO: every
 * external effect flows through `callModel` and the tool handlers the caller injects.
 *
 * No-authority invariant: a tool with `sideEffecting: true` is REFUSED unless the
 * run is invoked with `allowSideEffects: true`. Default deny. A refusal is fed back
 * as an observation (the model can pick a read-only path) and is NOT an exception.
 *
 * Untrusted tool results: a tool result is text the loop did not write. It may be a
 * page someone else controls. Until 2026-08-02 it re-entered the transcript as an
 * ordinary user turn and was never screened, so a fetched document could carry
 * "ignore your instructions" straight into the next model call, indistinguishable
 * from the operator's own words. Now every result is screened by the injection
 * scanner and, if it survives, wrapped in a labelled untrusted-data envelope
 * (`@conduit/guardrails`). A result that fails the screen is withheld entirely and
 * the model is told the source was refused, so it neither sees the payload nor
 * invents a replacement for it.
 *
 * The envelope is a label, not a wall. See untrusted.ts for what a delimiter is
 * and is not worth. The invariant above is the part of this file that actually
 * holds under a successful injection.
 *
 * Termination: the loop returns when the model gives a final answer, or when one of
 * three bounds trips: the `maxSteps` model-turn cap, a token/USD run budget, or the
 * run revisiting a state it has already been in. Each bound reports itself on
 * `stopReason` and carries a user-facing `notice` describing how far the run got.
 * See stop.ts for why one bound was not enough.
 */
import { screenAndWrapUntrusted } from "../../guardrails/src/untrusted.ts";
import type { ChatMessage } from "../../inference/src/core";
import { validate, type ValidationError } from "./schema";
import { selectSkills, type Skill, type SkillContext } from "./skill";
import {
  ZERO_SPEND,
  addUsage,
  budgetBreach,
  budgetGaps,
  stateKey,
  stopNotice,
  type RunBudget,
  type Spend,
  type StopReason,
  type TurnUsage,
} from "./stop";
import { toToolSpec, type Tool, type ToolSpec } from "./tool";

/** What the model proposes on a turn: exactly one of a tool call or a final answer. */
export interface ModelTurn {
  toolCall?: { name: string; args: unknown };
  finalAnswer?: string;
  /**
   * What this turn consumed, if the caller's `callModel` knows. Optional: the
   * loop cannot compute it, because pricing lives in `@conduit/inference` and
   * only `callModel` knows which model it called. A run budget can only bound
   * what is reported here, and `budgetEnforceable` on the result says whether
   * it was.
   */
  usage?: TurnUsage;
}

/**
 * Injected model-call function. The shape mirrors the inference core's resolve call
 * (system + messages), extended with the advertised tools. Tests mock this.
 */
export type CallModel = (input: {
  system: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
}) => Promise<ModelTurn>;

/** One recorded step of the run, for the returned trace. */
export type StepRecord =
  | { kind: "tool_call"; tool: string; args: unknown; ok: true; result: unknown }
  | { kind: "tool_error"; tool: string; args: unknown; ok: false; error: AgentError }
  | { kind: "final"; answer: string }
  | { kind: "no_action"; note: string };

export type AgentErrorKind =
  | "unknown_tool"
  | "invalid_args"
  | "side_effect_refused"
  | "handler_error"
  /** The tool ran, and its result carried prompt-injection patterns. The result
   *  was withheld from the model rather than enveloped. */
  | "untrusted_content_refused";

export interface AgentError {
  kind: AgentErrorKind;
  message: string;
  /** Present for invalid_args: the schema validation failures. */
  validation?: ValidationError[];
  /** Present for untrusted_content_refused: the injection labels that fired. */
  patterns?: string[];
}

export interface RunAgentInput {
  goal: string;
  tools: readonly Tool[];
  skills?: readonly Skill[];
  callModel: CallModel;
  maxSteps: number;
  /** Extra run context passed to skill intent predicates. */
  context?: string;
  /** Base system prompt; skill instructions are appended. A sensible default is used. */
  system?: string;
  /** No-authority override: side-effecting tools only run when this is true. */
  allowSideEffects?: boolean;
  /** Fixed envelope nonce. Tests only: in a real run the nonce must be
   *  unpredictable so tool output cannot forge the closing marker. */
  untrustedNonce?: string;
  /**
   * Token and/or USD ceiling for the whole run. Omitted means only the step cap
   * applies, which is the behaviour every caller had before 2026-08-02.
   */
  budget?: RunBudget;
  /**
   * Halt when the run reaches a (tool, args, result) state it has already been
   * in. On by default: a repeated state is a fixed point that would otherwise
   * burn the remaining step cap producing nothing. See `stateKey` in stop.ts
   * for why the result is part of the state and a poller does not false-halt.
   */
  detectLoops?: boolean;
}

export interface RunAgentResult {
  /** The model's final answer, or undefined if the loop hit maxSteps first. */
  answer?: string;
  /** Ordered trace of every step taken. */
  steps: StepRecord[];
  /**
   * True when the loop stopped because it reached maxSteps without a final answer.
   * Kept for callers written before the other two bounds existed; it is exactly
   * `stopReason === "max_steps"`. Prefer `stopReason`, which distinguishes a run
   * that ran out of steps from one that ran out of money or went in circles.
   */
  stoppedAtCap: boolean;
  /** Which of the four terminations ended the run. */
  stopReason: StopReason;
  /**
   * What to show the user when a bound tripped. Empty string on a final answer,
   * because then the answer is what the user sees.
   */
  notice: string;
  /** What the run consumed, as reported by `callModel`. */
  spend: Spend;
  /**
   * Empty when a declared budget was actually enforceable against what was
   * measured. Non-empty means the ceiling could not have tripped however long
   * the run went, e.g. a USD budget with a `callModel` that reports no cost.
   * A caller that ignores this is trusting a bound that does not exist.
   */
  budgetEnforceable: string[];
  /** The ids of the skills whose instructions were injected this run. */
  loadedSkills: string[];
}

const DEFAULT_SYSTEM =
  "You are a Conduit agent. Work toward the goal step by step. On each turn either " +
  "call one tool to gather information or take an allowed action, or give a final " +
  "answer once you have enough. Do not invent tool results.";

function buildSystemPrompt(base: string, goal: string, skills: Skill[]): string {
  const parts = [base, `\nGoal: ${goal}`];
  if (skills.length > 0) {
    parts.push("\nActive skills:");
    for (const skill of skills) {
      parts.push(`\n[skill:${skill.id}]\n${skill.instructions}`);
    }
  }
  return parts.join("\n");
}

export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const {
    goal,
    tools,
    skills = [],
    callModel,
    maxSteps,
    context,
    system = DEFAULT_SYSTEM,
    allowSideEffects = false,
    untrustedNonce,
    budget,
    detectLoops = true,
  } = input;

  const skillCtx: SkillContext = { goal, context };
  const matchedSkills = selectSkills(skills, skillCtx);
  const systemPrompt = buildSystemPrompt(system, goal, matchedSkills);
  const toolSpecs = tools.map(toToolSpec);
  const toolByName = new Map(tools.map((t) => [t.name, t]));

  const messages: ChatMessage[] = [{ role: "user", content: goal }];
  const steps: StepRecord[] = [];
  const skillIds = matchedSkills.map((s) => s.id);

  let spend: Spend = ZERO_SPEND;
  const seenStates = new Set<string>();

  /** Assemble a result. One place, so every exit reports the same shape. */
  const finish = (reason: StopReason, detail: string, answer?: string): RunAgentResult => ({
    answer,
    steps,
    stoppedAtCap: reason === "max_steps",
    stopReason: reason,
    notice: stopNotice(reason, detail, steps.length),
    spend,
    budgetEnforceable: budgetGaps(spend, budget),
    loadedSkills: skillIds,
  });

  for (let step = 0; step < maxSteps; step++) {
    const turn = await callModel({ system: systemPrompt, messages, tools: toolSpecs });

    // Charge the turn before acting on it. A turn that was spent is spent
    // whether or not its content turns out to be usable.
    spend = addUsage(spend, turn.usage);

    if (turn.finalAnswer !== undefined) {
      steps.push({ kind: "final", answer: turn.finalAnswer });
      messages.push({ role: "assistant", content: turn.finalAnswer });
      return finish("final_answer", "", turn.finalAnswer);
    }

    // The budget is checked after the turn is charged and before another one is
    // bought. A run may finish one turn over the line; it may not start another.
    const breach = budgetBreach(spend, budget);
    if (breach) return finish("budget_exhausted", breach);

    if (!turn.toolCall) {
      // The model neither answered nor acted; record it and nudge it to decide.
      const note = "model returned neither a tool call nor a final answer";
      steps.push({ kind: "no_action", note });
      messages.push({ role: "assistant", content: "(no action)" });
      messages.push({ role: "user", content: observation({ error: { kind: "handler_error", message: note } }) });
      continue;
    }

    const { name, args } = turn.toolCall;
    messages.push({ role: "assistant", content: `call ${name} ${safeJson(args)}` });

    const tool = toolByName.get(name);
    if (!tool) {
      const error: AgentError = { kind: "unknown_tool", message: `no tool named "${name}"` };
      steps.push({ kind: "tool_error", tool: name, args, ok: false, error });
      messages.push({ role: "user", content: observation({ error }) });
      continue;
    }

    // No-authority invariant: refuse side-effecting tools unless explicitly allowed.
    if (tool.sideEffecting && !allowSideEffects) {
      const error: AgentError = {
        kind: "side_effect_refused",
        message: `tool "${name}" is side-effecting and refused (allowSideEffects is not set)`,
      };
      steps.push({ kind: "tool_error", tool: name, args, ok: false, error });
      messages.push({ role: "user", content: observation({ error }) });
      continue;
    }

    // Validate arguments before touching the handler.
    const result = validate(args, tool.jsonSchema);
    if (!result.valid) {
      const error: AgentError = {
        kind: "invalid_args",
        message: `arguments for "${name}" failed schema validation`,
        validation: result.errors,
      };
      steps.push({ kind: "tool_error", tool: name, args, ok: false, error });
      messages.push({ role: "user", content: observation({ error }) });
      continue;
    }

    // Run the handler; a throw becomes a structured error observation, never a
    // loop-level exception.
    try {
      const output = await tool.handler(args as Record<string, unknown>);
      // The result is untrusted text: screen it, then envelope what survives.
      // Nothing a tool returns enters the transcript unlabelled.
      const screened = screenAndWrapUntrusted(
        observation({ result: output }),
        { kind: "tool_result", name },
        { nonce: untrustedNonce },
      );
      if (screened.blocked) {
        const error: AgentError = {
          kind: "untrusted_content_refused",
          message:
            `the result of "${name}" carried prompt-injection patterns ` +
            `(${screened.scan.labels.join(", ")}) and was withheld from the model`,
          patterns: screened.scan.labels,
        };
        steps.push({ kind: "tool_error", tool: name, args, ok: false, error });
        // The refusal notice is ours, so it goes in as an ordinary turn. The
        // payload that caused it does not go in at all.
        messages.push({ role: "user", content: screened.text });
        continue;
      }
      steps.push({ kind: "tool_call", tool: name, args, ok: true, result: output });
      messages.push({ role: "user", content: screened.text });

      // Loop detection, on the successful path only. A repeated ERROR is not a
      // loop worth halting for: the error observation is precisely the new
      // information the model needs to correct itself, and halting on the
      // second identical validation failure would kill runs that were about to
      // recover. A repeated success is different, because it means the model
      // asked for something it already had and got the same answer back.
      if (detectLoops) {
        const key = stateKey(name, args, output);
        if (seenStates.has(key)) {
          return finish("loop_detected", `\`${name}\` returned an identical result for identical arguments a second time`);
        }
        seenStates.add(key);
      }
    } catch (err) {
      const error: AgentError = {
        kind: "handler_error",
        message: err instanceof Error ? err.message : String(err),
      };
      steps.push({ kind: "tool_error", tool: name, args, ok: false, error });
      messages.push({ role: "user", content: observation({ error }) });
    }
  }

  // Reached the step cap without a final answer.
  return finish("max_steps", `${maxSteps} step${maxSteps === 1 ? "" : "s"}`);
}

/** Serialize an observation for the transcript. Structured so a model can parse it. */
function observation(payload: { result?: unknown } | { error: AgentError }): string {
  return `OBSERVATION ${safeJson(payload)}`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
