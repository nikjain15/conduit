/**
 * The guardrails decision engine.
 *
 * runGuardrails takes a use case's GuardrailsConfig and the run-time context and
 * returns one decision: allow, redact, block, or escalate. It combines every
 * enabled signal fail-closed, so the most severe outcome always wins
 * (block > escalate > redact > allow) and any ambiguity resolves toward safety.
 *
 * Signals:
 *  - injectionGuard: a deterministic pattern screen over the input; a hit blocks
 *    when it is strong enough to act on alone, or when a weak label is
 *    corroborated (see injection.ts). An uncorroborated weak label is recorded
 *    and allowed, which is the false block fix.
 *  - pii: reuses @conduit/evals' pii_scan over the answer; a hit either masks the
 *    matches (redact) or refuses (block), per guardrails.piiAction.
 *  - outputSchema: reuses @conduit/evals' json_schema over the answer; a schema
 *    violation blocks.
 *  - hitlThreshold: an injected confidence below the threshold escalates to a human.
 *  - floors: mandatory eval keys that must be present in the context; a missing
 *    floor blocks (fail-closed), because a floor that did not run cannot be trusted.
 *
 * Every refusal is recorded with the pattern that caused it (ledger.ts), so a
 * false block is a number rather than an anecdote.
 *
 * Recovery: a use case may set `blockedRequestAction: "review"`, which turns a
 * refusal into an escalation. The floor stays on, the answer is still withheld,
 * and the request reaches a human instead of dying. Default stays "refuse".
 */
// Imported from the method module rather than the @conduit/evals package entry
// on purpose: the package entry re-exports judgeCheck, which imports the
// inference core, and the inference core now imports this engine. Going direct
// keeps that from being an import cycle.
import { builtInMethods, type CheckMethod, type MethodResult } from "../../evals/src/methods.ts";
import type { GuardrailsConfig } from "@conduit/profile";
import { isBlockWorthy, scanInjection } from "./injection.ts";
import { recordBlockEvent, type BlockEvent, type BlockOutcome } from "./ledger.ts";
import { maskPii } from "./redact.ts";

/** The four decisions, ordered least to most severe. */
export type GuardrailAction = "allow" | "redact" | "block" | "escalate";

/** One reason a signal contributed to the decision. */
export interface GuardrailReason {
  /** The signal that fired, for example "injectionGuard" or "floor". */
  signal: "injectionGuard" | "pii" | "outputSchema" | "hitlThreshold" | "floor";
  /** The action this signal argued for. */
  action: GuardrailAction;
  /** Human readable explanation. */
  detail: string;
  /** For pattern based signals: the labels that matched. Carried so a refusal can
   *  be counted by cause without re-running the scan over the input. */
  patterns?: string[];
}

/** The engine's verdict for one request. */
export interface GuardrailDecision {
  action: GuardrailAction;
  reasons: GuardrailReason[];
  /** Present only when the final action is "redact": the masked answer to serve. */
  redactedAnswer?: string;
  /** True when the decision would have been a refusal and the use case routed it
   *  to human review instead. The action is then "escalate". */
  routedToReview?: boolean;
}

/** Everything the engine reads. Each field is optional; a signal that has nothing
 *  to read is skipped, except floors, which fail closed when their key is absent. */
export interface GuardrailContext {
  /** The raw user input, screened by injectionGuard. */
  input?: string;
  /** The produced answer, screened by pii and outputSchema. */
  answer?: string;
  /** An injected confidence in [0, 1], compared against hitlThreshold. */
  confidence?: number;
  /** The eval keys that ran for this request, checked against guardrails.floors. */
  presentEvalKeys?: string[];
  /** Labels carried onto any recorded refusal so blocks can be counted per use
   *  case and tenant. Never used in the decision itself. */
  useCase?: string;
  tenant?: string;
}

/** Injected, mockable method implementations. Defaults to the built-in check
 *  methods so tests can substitute a stub without a registry round-trip. */
export interface GuardrailDeps {
  piiScan?: CheckMethod;
  jsonSchema?: CheckMethod;
  /** Durable sink for refusals. The in-process ledger is always written; this is
   *  the seam for a host that wants them in a log, a metric, or a table. */
  onBlock?: (event: BlockEvent) => void;
  /** Injected clock, so a recorded event is testable. */
  now?: () => number;
}

/** Severity rank so the most severe action wins a combine. */
const SEVERITY: Record<GuardrailAction, number> = {
  allow: 0,
  redact: 1,
  escalate: 2,
  block: 3,
};

function moreSevere(a: GuardrailAction, b: GuardrailAction): GuardrailAction {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

async function toResult(r: MethodResult | Promise<MethodResult>): Promise<MethodResult> {
  return await Promise.resolve(r);
}

/**
 * Run every enabled guardrail and combine the signals fail-closed. Async because
 * a check method may be async; the built-ins used here are synchronous.
 */
export async function runGuardrails(
  guardrails: GuardrailsConfig | undefined,
  ctx: GuardrailContext,
  deps: GuardrailDeps = {},
): Promise<GuardrailDecision> {
  const g = guardrails ?? {};
  const piiScan = deps.piiScan ?? builtInMethods.pii_scan;
  const jsonSchema = deps.jsonSchema ?? builtInMethods.json_schema;
  const now = deps.now ?? Date.now;

  const reasons: GuardrailReason[] = [];
  let action: GuardrailAction = "allow";
  let redactedAnswer: string | undefined;

  /** Write one refusal (or near refusal) to the ledger and any injected sink. */
  const record = (signal: string, patterns: string[], outcome: BlockOutcome): void => {
    const event: BlockEvent = {
      at: now(),
      signal,
      patterns,
      outcome,
      useCase: ctx.useCase,
      tenant: ctx.tenant,
    };
    recordBlockEvent(event);
    // A logging failure must never change a safety decision.
    try {
      deps.onBlock?.(event);
    } catch {
      /* swallow */
    }
  };

  // 1. Injection guard over the input. A hit blocks only when it is strong enough
  //    to act on alone or is corroborated; see isBlockWorthy in injection.ts.
  if (g.injectionGuard && ctx.input) {
    const scan = scanInjection(ctx.input);
    if (isBlockWorthy(scan)) {
      const support = scan.corroborators.length > 0 ? `, corroborated by: ${scan.corroborators.join(", ")}` : "";
      reasons.push({
        signal: "injectionGuard",
        action: "block",
        detail: `heuristic injection patterns matched: ${scan.labels.join(", ")}${support}`,
        patterns: scan.labels,
      });
      action = moreSevere(action, "block");
    } else if (scan.hit) {
      // A weak label with nothing behind it. Allowed on purpose, and recorded on
      // purpose: these near misses are the evidence for tuning the pattern set.
      reasons.push({
        signal: "injectionGuard",
        action: "allow",
        detail:
          `weak injection pattern matched (${scan.labels.join(", ")}) with no corroborating ` +
          `signal, so the request was allowed rather than refused`,
        patterns: scan.labels,
      });
      record("injectionGuard", scan.labels, "held_for_corroboration");
    }
  }

  // 2. PII over the answer. A hit redacts (mask) or blocks, per policy.
  if (g.pii && ctx.answer !== undefined) {
    const result = await toResult(piiScan({ answer: ctx.answer }));
    if (!result.pass) {
      const policy = g.piiAction ?? "redact";
      if (policy === "block") {
        reasons.push({ signal: "pii", action: "block", detail: result.detail ?? "PII detected" });
        action = moreSevere(action, "block");
      } else {
        const masked = maskPii(ctx.answer);
        redactedAnswer = masked.text;
        reasons.push({
          signal: "pii",
          action: "redact",
          detail: `masked ${masked.count} PII match${masked.count === 1 ? "" : "es"}`,
        });
        action = moreSevere(action, "redact");
      }
    }
  }

  // 3. Output schema over the answer. A violation blocks.
  if (g.outputSchema !== undefined && ctx.answer !== undefined) {
    const result = await toResult(
      jsonSchema({ answer: ctx.answer, params: { schema: g.outputSchema } }),
    );
    if (!result.pass) {
      reasons.push({
        signal: "outputSchema",
        action: "block",
        detail: result.detail ?? "answer does not match the output schema",
      });
      action = moreSevere(action, "block");
    }
  }

  // 4. Human-in-the-loop threshold. Low confidence escalates.
  if (typeof g.hitlThreshold === "number" && typeof ctx.confidence === "number") {
    if (ctx.confidence < g.hitlThreshold) {
      reasons.push({
        signal: "hitlThreshold",
        action: "escalate",
        detail: `confidence ${ctx.confidence} is below the review threshold ${g.hitlThreshold}`,
      });
      action = moreSevere(action, "escalate");
    }
  }

  // 5. Mandatory floors. A missing floor blocks (fail-closed).
  if (g.floors && g.floors.length > 0) {
    const present = new Set(ctx.presentEvalKeys ?? []);
    for (const key of g.floors) {
      if (!present.has(key)) {
        reasons.push({
          signal: "floor",
          action: "block",
          detail: `mandatory floor "${key}" did not run`,
        });
        action = moreSevere(action, "block");
      }
    }
  }

  // Recovery path. A refusal with nowhere to go is terminal for the user: the
  // request dies and only a code change brings it back. When the use case opts
  // in, the refusal becomes an escalation instead. The answer is still withheld,
  // the floor still ran, and a human now has the request. Default is "refuse",
  // so nothing changes for a use case that has not chosen this.
  let routedToReview = false;
  if (action === "block" && g.blockedRequestAction === "review") {
    action = "escalate";
    routedToReview = true;
    reasons.push({
      signal: "injectionGuard",
      action: "escalate",
      detail: "refusal routed to human review by the use case's blockedRequestAction",
    });
  }

  // Record every refusal with the pattern that caused it, so false blocks are
  // countable rather than estimated. Reasons that argued for a block are the
  // causes, even when a later signal made the final action more severe.
  if (routedToReview || action === "block") {
    const causes = reasons.filter((r) => r.action === "block");
    const outcome: BlockOutcome = routedToReview ? "routed_to_review" : "blocked";
    for (const cause of causes) record(cause.signal, cause.patterns ?? [], outcome);
  }

  // Only surface the redacted answer when redact is the winning action.
  const base: GuardrailDecision =
    action === "redact" && redactedAnswer !== undefined
      ? { action, reasons, redactedAnswer }
      : { action, reasons };
  return routedToReview ? { ...base, routedToReview } : base;
}
