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

export { scanInjection, isBlockWorthy, WEAK_LABELS, type InjectionScan } from "./injection.ts";
export { maskPii } from "./redact.ts";

export {
  recordBlockEvent,
  blockLedgerSnapshot,
  falseBlockRate,
  resetBlockLedger,
  type BlockEvent,
  type BlockOutcome,
  type BlockLedgerSnapshot,
} from "./ledger.ts";

export {
  wrapUntrusted,
  screenAndWrapUntrusted,
  type UntrustedSource,
  type EnvelopeOptions,
  type ScreenedUntrusted,
} from "./untrusted.ts";
