/**
 * Sample control plane data for the console.
 *
 * Every value here is placeholder configuration for demonstration. It is not a
 * measurement of any real system. Pages that render these figures label them as
 * sample so a reader never mistakes them for live production metrics.
 */

export const SAMPLE_NOTICE =
  "Sample configuration. Values are placeholders for demonstration, not live production metrics.";

export interface ModelOption {
  ref: string;
  label: string;
  /** Whether the model accepts temperature, top_p, top_k sampling params. */
  supportsSampling: boolean;
}

/**
 * Model catalog. The sampling flag mirrors the inference core contract: the
 * newer reasoning models reject sampling params, Haiku 4.5 and older accept
 * them. There is no Haiku 5.
 */
export const MODEL_CATALOG: ModelOption[] = [
  { ref: "anthropic/claude-opus-5", label: "Opus 5", supportsSampling: false },
  { ref: "anthropic/claude-opus-4-8", label: "Opus 4.8", supportsSampling: false },
  { ref: "anthropic/claude-sonnet-5", label: "Sonnet 5", supportsSampling: false },
  { ref: "anthropic/claude-fable-5", label: "Fable 5", supportsSampling: false },
  { ref: "anthropic/claude-haiku-4-5", label: "Haiku 4.5", supportsSampling: true },
];

export function modelLabel(ref: string): string {
  return MODEL_CATALOG.find((m) => m.ref === ref)?.label ?? ref;
}

export interface UseCase {
  id: string;
  name: string;
  summary: string;
  /** Customer facing or financial use cases may not reuse cached answers. */
  cachingAllowed: boolean;
}

export const USE_CASES: UseCase[] = [
  {
    id: "support-triage",
    name: "Support triage",
    summary: "Classify and route inbound support tickets by intent and urgency.",
    cachingAllowed: true,
  },
  {
    id: "kb-search",
    name: "Knowledge search",
    summary: "Grounded answers over the internal knowledge base with citations.",
    cachingAllowed: true,
  },
  {
    id: "sales-draft",
    name: "Sales email drafting",
    summary: "Draft outreach and follow up copy for the sales team to edit.",
    cachingAllowed: true,
  },
  {
    id: "billing-summary",
    name: "Billing summary",
    summary: "Explain a customer invoice in plain language inside the account view.",
    cachingAllowed: false,
  },
  {
    id: "code-review",
    name: "Code review assistant",
    summary: "Surface risky diffs and suggest fixes on internal pull requests.",
    cachingAllowed: true,
  },
];

export interface ModelConfig {
  useCaseId: string;
  mainModel: string;
  backupModel: string;
  monthlyCapUsd: number;
  reuseCachedAnswers: boolean;
}

export const MODEL_CONFIG: ModelConfig[] = [
  {
    useCaseId: "support-triage",
    mainModel: "anthropic/claude-haiku-4-5",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 1200,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "kb-search",
    mainModel: "anthropic/claude-sonnet-5",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 2500,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "sales-draft",
    mainModel: "anthropic/claude-sonnet-5",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 900,
    reuseCachedAnswers: false,
  },
  {
    useCaseId: "billing-summary",
    mainModel: "anthropic/claude-opus-4-8",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 1500,
    reuseCachedAnswers: false,
  },
  {
    useCaseId: "code-review",
    mainModel: "anthropic/claude-opus-5",
    backupModel: "anthropic/claude-opus-4-8",
    monthlyCapUsd: 2000,
    reuseCachedAnswers: true,
  },
];

export interface EvalGate {
  id: string;
  label: string;
  metric: string;
  threshold: string;
  kind: "inline" | "batch";
}

export interface EvalSetup {
  useCaseId: string;
  gates: EvalGate[];
}

export const EVAL_SETUP: EvalSetup[] = [
  {
    useCaseId: "support-triage",
    gates: [
      { id: "intent-acc", label: "Intent accuracy", metric: "labelled set match rate", threshold: "at or above 0.90", kind: "batch" },
      { id: "pii-block", label: "PII leak check", metric: "flagged responses", threshold: "0 allowed", kind: "inline" },
    ],
  },
  {
    useCaseId: "kb-search",
    gates: [
      { id: "grounding", label: "Grounding", metric: "answers with a valid citation", threshold: "at or above 0.95", kind: "inline" },
      { id: "faithful", label: "Faithfulness", metric: "judge panel agreement", threshold: "at or above 0.85", kind: "batch" },
    ],
  },
  {
    useCaseId: "sales-draft",
    gates: [
      { id: "tone", label: "Tone check", metric: "brand voice judge score", threshold: "at or above 0.80", kind: "batch" },
      { id: "claims", label: "No unverified claims", metric: "flagged claims per draft", threshold: "0 allowed", kind: "inline" },
    ],
  },
  {
    useCaseId: "billing-summary",
    gates: [
      { id: "numeric", label: "Numeric fidelity", metric: "figures matching source invoice", threshold: "1.00 required", kind: "inline" },
      { id: "no-advice", label: "No financial advice", metric: "flagged advice statements", threshold: "0 allowed", kind: "inline" },
    ],
  },
  {
    useCaseId: "code-review",
    gates: [
      { id: "false-pos", label: "False positive rate", metric: "review comments marked wrong", threshold: "at or below 0.15", kind: "batch" },
      { id: "secret-scan", label: "Secret scan", metric: "leaked secrets in output", threshold: "0 allowed", kind: "inline" },
    ],
  },
];

/** Ordered month labels for the cost trend, oldest to newest. */
export const COST_MONTHS = ["Feb", "Mar", "Apr", "May", "Jun", "Jul"];

/** Sample monthly spend in USD per use case, aligned to COST_MONTHS. */
export const COST_TREND: Record<string, number[]> = {
  "support-triage": [640, 705, 690, 810, 870, 940],
  "kb-search": [1180, 1320, 1500, 1610, 1740, 1880],
  "sales-draft": [420, 460, 510, 540, 600, 660],
  "billing-summary": [880, 910, 1010, 1120, 1180, 1260],
  "code-review": [1300, 1410, 1520, 1600, 1710, 1820],
};

export interface SloRow {
  useCaseId: string;
  p95LatencyMs: number;
  p95TargetMs: number;
  costPerAnswerUsd: number;
  costTargetUsd: number;
  gateBlockRate: number;
  gateBlockTarget: number;
}

/** SUQS: service, usage, quality, spend service level objectives. */
export const SLO_ROWS: SloRow[] = [
  { useCaseId: "support-triage", p95LatencyMs: 1400, p95TargetMs: 2000, costPerAnswerUsd: 0.004, costTargetUsd: 0.006, gateBlockRate: 0.01, gateBlockTarget: 0.03 },
  { useCaseId: "kb-search", p95LatencyMs: 2600, p95TargetMs: 2500, costPerAnswerUsd: 0.019, costTargetUsd: 0.02, gateBlockRate: 0.02, gateBlockTarget: 0.05 },
  { useCaseId: "sales-draft", p95LatencyMs: 1900, p95TargetMs: 3000, costPerAnswerUsd: 0.012, costTargetUsd: 0.015, gateBlockRate: 0.04, gateBlockTarget: 0.03 },
  { useCaseId: "billing-summary", p95LatencyMs: 2200, p95TargetMs: 2500, costPerAnswerUsd: 0.031, costTargetUsd: 0.03, gateBlockRate: 0.01, gateBlockTarget: 0.02 },
  { useCaseId: "code-review", p95LatencyMs: 3400, p95TargetMs: 4000, costPerAnswerUsd: 0.058, costTargetUsd: 0.06, gateBlockRate: 0.06, gateBlockTarget: 0.05 },
];

export function useCaseName(id: string): string {
  return USE_CASES.find((u) => u.id === id)?.name ?? id;
}
