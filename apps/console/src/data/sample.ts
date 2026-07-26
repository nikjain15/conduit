/**
 * Sample control plane data for the console.
 *
 * Every value here is placeholder configuration for demonstration. It is not a
 * measurement of any real system. Pages that render these figures label them as
 * sample so a reader never mistakes them for live production metrics.
 */

import type { UseCaseProfile } from "@conduit/client";

export const SAMPLE_NOTICE =
  "Sample configuration. Values are placeholders for demonstration, not live production metrics.";

export interface ModelOption {
  ref: string;
  label: string;
  /** Whether the model accepts temperature, top_p, top_k sampling params. */
  supportsSampling: boolean;
}

/**
 * Model catalog across all three provider adapters the inference core supports:
 * Anthropic (managed), Cloudflare Workers-AI, and OpenRouter (one key, hundreds
 * of open and closed models). The ref is provider-prefixed; the first segment is
 * the provider, the remainder is the provider model id.
 *
 * The sampling flag mirrors the inference core contract: the current Anthropic
 * reasoning tiers reject sampling params (temperature, top_p, top_k) with an
 * HTTP 400, while Haiku 4.5 and the OpenAI-compatible open models accept them.
 * There is no Haiku 5.
 */
export const MODEL_CATALOG: ModelOption[] = [
  // Anthropic (managed)
  { ref: "anthropic/claude-opus-5", label: "Opus 5", supportsSampling: false },
  { ref: "anthropic/claude-opus-4-8", label: "Opus 4.8", supportsSampling: false },
  { ref: "anthropic/claude-sonnet-5", label: "Sonnet 5", supportsSampling: false },
  { ref: "anthropic/claude-fable-5", label: "Fable 5", supportsSampling: false },
  { ref: "anthropic/claude-haiku-4-5", label: "Haiku 4.5", supportsSampling: true },
  // Cloudflare Workers-AI (hosted open weights, near the edge)
  { ref: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B (Workers-AI)", supportsSampling: true },
  { ref: "workers-ai/@cf/qwen/qwen2.5-coder-32b-instruct", label: "Qwen2.5 Coder 32B (Workers-AI)", supportsSampling: true },
  // OpenRouter (one key, open and closed models, OpenAI-compatible)
  { ref: "openrouter/meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B (OpenRouter)", supportsSampling: true },
  { ref: "openrouter/qwen/qwen-2.5-72b-instruct", label: "Qwen2.5 72B (OpenRouter)", supportsSampling: true },
  { ref: "openrouter/deepseek/deepseek-chat", label: "DeepSeek V3 (OpenRouter)", supportsSampling: true },
  { ref: "openrouter/mistralai/mistral-large", label: "Mistral Large (OpenRouter)", supportsSampling: true },
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
    // Bulk classify: cheap open weights near the edge, escalate to a managed tier on cap.
    useCaseId: "support-triage",
    mainModel: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 1200,
    reuseCachedAnswers: true,
  },
  {
    // Grounded retrieval: an open 70B via OpenRouter for bulk, frontier Claude for hard queries.
    useCaseId: "kb-search",
    mainModel: "openrouter/meta-llama/llama-3.3-70b-instruct",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 2500,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "sales-draft",
    mainModel: "openrouter/mistralai/mistral-large",
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

/**
 * Sample use case profiles.
 *
 * Each profile is the single config object per use case: routing, retrieval,
 * agent, prompt, guardrails, evals, and SLOs. These are assembled from the same
 * sample configuration above so the console's Prompts, Guardrails, and Agent
 * tabs can read a coherent object per use case. Every value is placeholder
 * configuration for demonstration, not a live measurement. The follow up
 * workstreams replace the read only views with real editors.
 */
const SAMPLE_TENANT = "org:example";

/** Retrieval config for the use cases that ground answers over a corpus. */
const SAMPLE_RETRIEVAL: Record<string, UseCaseProfile["retrieval"]> = {
  "kb-search": {
    source: "internal-kb",
    chunking: { size: 800, overlap: 100 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 6,
    groundingThreshold: 0.95,
  },
  "billing-summary": {
    source: "invoices",
    chunking: { size: 600, overlap: 80 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 4,
    groundingThreshold: 0.9,
  },
};

/** Agent config for the use cases that run a tool loop. */
const SAMPLE_AGENT: Record<string, UseCaseProfile["agent"]> = {
  "code-review": {
    mode: "loop",
    tools: ["read-diff", "run-linter", "search-repo"],
    skills: ["review-checklist"],
    maxSteps: 6,
  },
  "support-triage": {
    mode: "single",
    tools: ["classify-intent"],
    skills: [],
  },
};

/** Guardrails config per use case. */
const SAMPLE_GUARDRAILS: Record<string, UseCaseProfile["guardrails"]> = {
  "support-triage": { pii: true, injectionGuard: true, floors: ["no-pii-leak"] },
  "kb-search": { pii: true, injectionGuard: true, floors: ["cite-or-refuse"] },
  "sales-draft": { pii: false, injectionGuard: true, floors: ["no-unverified-claims"] },
  "billing-summary": { pii: true, injectionGuard: true, hitlThreshold: 0.7, floors: ["numeric-fidelity", "no-financial-advice"] },
  "code-review": { pii: false, injectionGuard: true, floors: ["no-secret-leak"] },
};

/** System prompt reference per use case, resolved against the prompt registry. */
const SAMPLE_SYSTEM_REF: Record<string, string> = {
  "support-triage": "support-triage.system",
  "kb-search": "kb-search.system",
  "sales-draft": "sales-draft.system",
  "billing-summary": "billing-summary.system",
  "code-review": "code-review.system",
};

/** The registry check method each sample gate resolves to. Keyed by gate id so
 *  the console editor shows a real registry method, not the prose metric name. */
const GATE_METHOD: Record<string, string> = {
  "intent-acc": "exact_match",
  "pii-block": "pii_scan",
  grounding: "groundedness",
  faithful: "llm_judge",
  tone: "llm_judge",
  claims: "llm_judge",
  numeric: "numeric_match",
  "no-advice": "regex",
  "false-pos": "llm_judge",
  "secret-scan": "pii_scan",
};

function evalsForUseCase(useCaseId: string): UseCaseProfile["evals"] {
  const setup = EVAL_SETUP.find((s) => s.useCaseId === useCaseId);
  if (!setup) return [];
  return setup.gates.map((g) => ({
    key: g.id,
    method: GATE_METHOD[g.id] ?? "regex",
    floor: g.kind === "inline",
    mandatory: true,
    when: g.kind,
  }));
}

function sloForUseCase(useCaseId: string): UseCaseProfile["slo"] {
  const row = SLO_ROWS.find((s) => s.useCaseId === useCaseId);
  if (!row) return {};
  return {
    p95LatencyMs: row.p95TargetMs,
    costPerAnswerUsd: row.costTargetUsd,
    gateBlockRate: row.gateBlockTarget,
  };
}

export const SAMPLE_PROFILES: UseCaseProfile[] = USE_CASES.map((u) => {
  const cfg = MODEL_CONFIG.find((c) => c.useCaseId === u.id);
  return {
    id: u.id,
    name: u.name,
    tenant: SAMPLE_TENANT,
    routing: {
      main: cfg?.mainModel ?? "anthropic/claude-haiku-4-5",
      backup: cfg?.backupModel,
      capUsd: cfg?.monthlyCapUsd,
      cache: cfg?.reuseCachedAnswers ?? false,
    },
    retrieval: SAMPLE_RETRIEVAL[u.id] ?? null,
    agent: SAMPLE_AGENT[u.id],
    prompt: { systemRef: SAMPLE_SYSTEM_REF[u.id] ?? `${u.id}.system` },
    guardrails: SAMPLE_GUARDRAILS[u.id] ?? {},
    evals: evalsForUseCase(u.id),
    slo: sloForUseCase(u.id),
  };
});

export function sampleProfile(useCaseId: string): UseCaseProfile | undefined {
  return SAMPLE_PROFILES.find((p) => p.id === useCaseId);
}
