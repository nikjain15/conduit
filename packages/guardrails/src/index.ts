/**
 * @conduit/guardrails public surface.
 *
 * The fail-closed guardrails decision engine plus its two deterministic screens:
 * a prompt-injection detector and a PII masker. runGuardrails reads a use case's
 * GuardrailsConfig and combines every enabled signal into one allow, redact,
 * block, or escalate decision, reusing @conduit/evals' pii_scan and json_schema.
 */
export {
  runGuardrails,
  type GuardrailAction,
  type GuardrailReason,
  type GuardrailDecision,
  type GuardrailContext,
  type GuardrailDeps,
} from "./engine.ts";

export { scanInjection, type InjectionScan } from "./injection.ts";
export { maskPii } from "./redact.ts";
