/**
 * The guardrails decision engine.
 *
 * runGuardrails takes a use case's GuardrailsConfig and the run-time context and
 * returns one decision: allow, redact, block, or escalate. It combines every
 * enabled signal fail-closed, so the most severe outcome always wins
 * (block > escalate > redact > allow) and any ambiguity resolves toward safety.
 *
 * Signals:
 *  - injectionGuard: a deterministic pattern screen over the input; a hit blocks.
 *  - pii: reuses @conduit/evals' pii_scan over the answer; a hit either masks the
 *    matches (redact) or refuses (block), per guardrails.piiAction.
 *  - outputSchema: reuses @conduit/evals' json_schema over the answer; a schema
 *    violation blocks.
 *  - hitlThreshold: an injected confidence below the threshold escalates to a human.
 *  - floors: mandatory eval keys that must be present in the context; a missing
 *    floor blocks (fail-closed), because a floor that did not run cannot be trusted.
 */
import { builtInMethods, type CheckMethod, type MethodResult } from "@conduit/evals";
import type { GuardrailsConfig } from "@conduit/profile";
import { scanInjection } from "./injection.ts";
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
}

/** The engine's verdict for one request. */
export interface GuardrailDecision {
  action: GuardrailAction;
  reasons: GuardrailReason[];
  /** Present only when the final action is "redact": the masked answer to serve. */
  redactedAnswer?: string;
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
}

/** Injected, mockable method implementations. Defaults to the @conduit/evals
 *  built-ins so tests can substitute a stub without a registry round-trip. */
export interface GuardrailDeps {
  piiScan?: CheckMethod;
  jsonSchema?: CheckMethod;
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

  const reasons: GuardrailReason[] = [];
  let action: GuardrailAction = "allow";
  let redactedAnswer: string | undefined;

  // 1. Injection guard over the input. A hit blocks.
  if (g.injectionGuard && ctx.input) {
    const scan = scanInjection(ctx.input);
    if (scan.hit) {
      reasons.push({
        signal: "injectionGuard",
        action: "block",
        detail: `heuristic injection patterns matched: ${scan.labels.join(", ")}`,
      });
      action = moreSevere(action, "block");
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

  // Only surface the redacted answer when redact is the winning action.
  return action === "redact" && redactedAnswer !== undefined
    ? { action, reasons, redactedAnswer }
    : { action, reasons };
}
