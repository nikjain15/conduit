/**
 * Sample control plane data for the console.
 *
 * Every value here is placeholder configuration for demonstration. It is not a
 * measurement of any real system. Pages that render these figures label them as
 * sample so a reader never mistakes them for live production metrics.
 *
 * The fleet is organized by app: every use case belongs to one product, so the
 * console can group its tabs by app (FounderFirst, RoleOS, Pulse, Rally) and
 * read a row as "FounderFirst / penny_categorize" rather than an anonymous
 * label. In production the app a caller belongs to is derived from the bearer
 * token, never the request body; here it is declared statically on each use
 * case so the offline console can render the same grouping.
 */

import type { UseCaseProfile } from "@conduit/client";
import type { UseCaseProfile as CatalogUseCaseProfile } from "@conduit/catalog";

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

/* ── The app fleet ────────────────────────────────────────────────────────── */

export interface AppInfo {
  id: string;
  label: string;
}

/** The real apps, in the order the console groups them. */
export const APPS: AppInfo[] = [
  { id: "founderfirst", label: "FounderFirst" },
  { id: "roleos", label: "RoleOS" },
  { id: "pulse", label: "Pulse" },
  { id: "rally", label: "Rally" },
];

export function appLabelOf(appId: string): string {
  return APPS.find((a) => a.id === appId)?.label ?? appId;
}

export interface UseCase {
  id: string;
  /** The app this use case belongs to. */
  app: string;
  /** The app's display label, denormalized for convenient rendering. */
  appLabel: string;
  name: string;
  summary: string;
  /** Customer facing or financial use cases may not reuse cached answers. */
  cachingAllowed: boolean;
}

/**
 * The real per-app use case fleet. Every card and row in the console reads from
 * this: the `app`/`appLabel` fields are what let each tab group by app and show
 * "app / useCase" on each card.
 */
export const USE_CASES: UseCase[] = [
  // FounderFirst
  {
    id: "penny_categorize",
    app: "founderfirst",
    appLabel: "FounderFirst",
    name: "penny_categorize",
    summary: "Categorize each ledger transaction into an expense category for founder bookkeeping.",
    cachingAllowed: true,
  },
  {
    id: "penny_insights",
    app: "founderfirst",
    appLabel: "FounderFirst",
    name: "penny_insights",
    summary: "Summarize spend patterns and surface saving opportunities grounded in the founder's ledger.",
    cachingAllowed: false,
  },
  // RoleOS
  {
    id: "match",
    app: "roleos",
    appLabel: "RoleOS",
    name: "match",
    summary: "Match candidates to open roles from the talent pool with grounded evidence.",
    cachingAllowed: true,
  },
  {
    id: "screen",
    app: "roleos",
    appLabel: "RoleOS",
    name: "screen",
    summary: "Screen inbound applicants against role requirements and rank them.",
    cachingAllowed: true,
  },
  {
    id: "build",
    app: "roleos",
    appLabel: "RoleOS",
    name: "build",
    summary: "Draft job descriptions and interview kits from a role brief.",
    cachingAllowed: true,
  },
  {
    id: "coach",
    app: "roleos",
    appLabel: "RoleOS",
    name: "coach",
    summary: "Coach hiring managers through interviews with structured, cited guidance.",
    cachingAllowed: true,
  },
  {
    id: "negotiate",
    app: "roleos",
    appLabel: "RoleOS",
    name: "negotiate",
    summary: "Guide offer negotiation against compensation bands and company policy.",
    cachingAllowed: false,
  },
  // Pulse
  {
    id: "ask-pulse",
    app: "pulse",
    appLabel: "Pulse",
    name: "ask-pulse",
    summary: "Answer questions over employee engagement survey results with citations.",
    cachingAllowed: true,
  },
  // Rally
  {
    id: "ask",
    app: "rally",
    appLabel: "Rally",
    name: "ask",
    summary: "Answer community and support questions grounded in the help center.",
    cachingAllowed: true,
  },
  {
    id: "detect",
    app: "rally",
    appLabel: "Rally",
    name: "detect",
    summary: "Detect spam, abuse, and policy violations in community posts.",
    cachingAllowed: true,
  },
];

export function useCaseName(id: string): string {
  return USE_CASES.find((u) => u.id === id)?.name ?? id;
}

/** The app a use case belongs to, or "" when the id is unknown. */
export function appOfUseCase(id: string): string {
  return USE_CASES.find((u) => u.id === id)?.app ?? "";
}

/** Group the fleet by app, in APPS order, for the grouped tab layout. */
export function useCasesByApp(): Array<{ app: AppInfo; useCases: UseCase[] }> {
  return APPS.map((app) => ({
    app,
    useCases: USE_CASES.filter((u) => u.app === app.id),
  })).filter((g) => g.useCases.length > 0);
}

/**
 * Catalog recommendation profiles per use case, keyed by use case id. These
 * drive the per-use-case model recommendations the mock (and the real gateway)
 * surface on the Models tab. Kept in the console because the fleet is
 * app-specific; the shape matches @conduit/catalog's UseCaseProfile.
 */
export const USE_CASE_RECO: Record<string, CatalogUseCaseProfile> = {
  penny_categorize: { task: "bulk", costSensitivity: "high" },
  penny_insights: { task: "grounded", costSensitivity: "low", needsLongContext: true },
  match: { task: "grounded", costSensitivity: "low", needsLongContext: true },
  screen: { task: "bulk", costSensitivity: "high" },
  build: { task: "draft", costSensitivity: "high" },
  coach: { task: "draft", costSensitivity: "low", needsTools: true },
  negotiate: { task: "financial", costSensitivity: "low", needsTools: true },
  "ask-pulse": { task: "grounded", costSensitivity: "low", needsLongContext: true },
  ask: { task: "grounded", costSensitivity: "low", needsLongContext: true },
  detect: { task: "bulk", costSensitivity: "high" },
};

export interface ModelConfig {
  useCaseId: string;
  mainModel: string;
  backupModel: string;
  monthlyCapUsd: number;
  reuseCachedAnswers: boolean;
}

export const MODEL_CONFIG: ModelConfig[] = [
  {
    // Bulk categorize: cheap open weights near the edge, escalate to a managed tier on cap.
    useCaseId: "penny_categorize",
    mainModel: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 800,
    reuseCachedAnswers: true,
  },
  {
    // Grounded financial insight: a frontier managed tier, no cached reuse.
    useCaseId: "penny_insights",
    mainModel: "anthropic/claude-sonnet-5",
    backupModel: "anthropic/claude-opus-4-8",
    monthlyCapUsd: 1500,
    reuseCachedAnswers: false,
  },
  {
    useCaseId: "match",
    mainModel: "openrouter/meta-llama/llama-3.3-70b-instruct",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 1800,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "screen",
    mainModel: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 1200,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "build",
    mainModel: "openrouter/mistralai/mistral-large",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 700,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "coach",
    mainModel: "anthropic/claude-sonnet-5",
    backupModel: "anthropic/claude-opus-4-8",
    monthlyCapUsd: 1600,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "negotiate",
    mainModel: "anthropic/claude-opus-4-8",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 900,
    reuseCachedAnswers: false,
  },
  {
    useCaseId: "ask-pulse",
    mainModel: "openrouter/meta-llama/llama-3.3-70b-instruct",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 1000,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "ask",
    mainModel: "openrouter/qwen/qwen-2.5-72b-instruct",
    backupModel: "anthropic/claude-sonnet-5",
    monthlyCapUsd: 2000,
    reuseCachedAnswers: true,
  },
  {
    useCaseId: "detect",
    mainModel: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    backupModel: "anthropic/claude-haiku-4-5",
    monthlyCapUsd: 1400,
    reuseCachedAnswers: true,
  },
];

export interface EvalGate {
  id: string;
  label: string;
  method: string;
  kind: "inline" | "batch";
}

export interface EvalSetup {
  useCaseId: string;
  gates: EvalGate[];
}

/** Per-use-case eval gates. `method` names a check in the shared @conduit/evals
 *  registry so the console editor shows a real registry method. */
export const EVAL_SETUP: EvalSetup[] = [
  {
    useCaseId: "penny_categorize",
    gates: [
      { id: "category-acc", label: "Category accuracy", method: "exact_match", kind: "batch" },
      { id: "pii-block", label: "PII leak check", method: "pii_scan", kind: "inline" },
    ],
  },
  {
    useCaseId: "penny_insights",
    gates: [
      { id: "numeric-fidelity", label: "Numeric fidelity", method: "numeric_match", kind: "inline" },
      { id: "no-advice", label: "No financial advice", method: "regex", kind: "inline" },
      { id: "usefulness", label: "Insight usefulness", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "match",
    gates: [
      { id: "grounding", label: "Grounding", method: "groundedness", kind: "inline" },
      { id: "relevance", label: "Match relevance", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "screen",
    gates: [
      { id: "pii-block", label: "PII leak check", method: "pii_scan", kind: "inline" },
      { id: "rank-acc", label: "Ranking accuracy", method: "exact_match", kind: "batch" },
    ],
  },
  {
    useCaseId: "build",
    gates: [
      { id: "no-bias", label: "No biased language", method: "regex", kind: "inline" },
      { id: "tone", label: "Brand tone", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "coach",
    gates: [
      { id: "pii-block", label: "PII leak check", method: "pii_scan", kind: "inline" },
      { id: "guidance", label: "Guidance quality", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "negotiate",
    gates: [
      { id: "band-fidelity", label: "Band fidelity", method: "numeric_match", kind: "inline" },
      { id: "no-advice", label: "No financial advice", method: "regex", kind: "inline" },
      { id: "policy", label: "Policy adherence", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "ask-pulse",
    gates: [
      { id: "grounding", label: "Grounding", method: "groundedness", kind: "inline" },
      { id: "faithful", label: "Faithfulness", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "ask",
    gates: [
      { id: "grounding", label: "Grounding", method: "groundedness", kind: "inline" },
      { id: "faithful", label: "Faithfulness", method: "llm_judge", kind: "batch" },
    ],
  },
  {
    useCaseId: "detect",
    gates: [
      { id: "verdict-schema", label: "Structured verdict", method: "json_schema", kind: "inline" },
      { id: "label-acc", label: "Label accuracy", method: "exact_match", kind: "batch" },
    ],
  },
];

/**
 * SUQS service level objective TARGETS per use case. These are configured
 * objectives (part of the use case profile), not measurements. Measured p95
 * latency, cost per answer, and gate block rate come only from real decisions
 * reported to the gateway, so there are no sample "current" values here.
 */
export interface SloTargets {
  p95LatencyMs: number;
  costPerAnswerUsd: number;
  gateBlockRate: number;
}

export const SLO_TARGETS: Record<string, SloTargets> = {
  penny_categorize: { p95LatencyMs: 1500, costPerAnswerUsd: 0.004, gateBlockRate: 0.02 },
  penny_insights: { p95LatencyMs: 3000, costPerAnswerUsd: 0.03, gateBlockRate: 0.02 },
  match: { p95LatencyMs: 2500, costPerAnswerUsd: 0.02, gateBlockRate: 0.05 },
  screen: { p95LatencyMs: 2000, costPerAnswerUsd: 0.006, gateBlockRate: 0.03 },
  build: { p95LatencyMs: 3000, costPerAnswerUsd: 0.015, gateBlockRate: 0.03 },
  coach: { p95LatencyMs: 3500, costPerAnswerUsd: 0.04, gateBlockRate: 0.04 },
  negotiate: { p95LatencyMs: 3000, costPerAnswerUsd: 0.05, gateBlockRate: 0.02 },
  "ask-pulse": { p95LatencyMs: 2500, costPerAnswerUsd: 0.02, gateBlockRate: 0.05 },
  ask: { p95LatencyMs: 2500, costPerAnswerUsd: 0.02, gateBlockRate: 0.05 },
  detect: { p95LatencyMs: 1500, costPerAnswerUsd: 0.005, gateBlockRate: 0.08 },
};

/* ── Sample use case profiles ─────────────────────────────────────────────── */

const SAMPLE_TENANT = "org:example";

/** Retrieval config for the use cases that ground answers over a corpus. */
const SAMPLE_RETRIEVAL: Record<string, UseCaseProfile["retrieval"]> = {
  penny_insights: {
    source: "vector",
    chunking: { size: 600, overlap: 80 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 5,
    groundingThreshold: 0.9,
  },
  match: {
    source: "hybrid",
    chunking: { size: 800, overlap: 100 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 8,
    groundingThreshold: 0.7,
  },
  "ask-pulse": {
    source: "vector",
    chunking: { size: 800, overlap: 120 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 6,
    groundingThreshold: 0.85,
  },
  ask: {
    source: "hybrid",
    chunking: { size: 800, overlap: 100 },
    embedModel: "workers-ai/@cf/baai/bge-large-en-v1.5",
    topK: 6,
    groundingThreshold: 0.9,
  },
};

/** Agent config for the use cases that run a tool loop or a single tool call. */
const SAMPLE_AGENT: Record<string, UseCaseProfile["agent"]> = {
  penny_categorize: { mode: "single", tools: ["classify-intent"], skills: [] },
  penny_insights: { mode: "loop", tools: ["fetch-ledger"], skills: [], maxSteps: 3 },
  match: { mode: "loop", tools: ["search-candidates", "fetch-role"], skills: ["cite-sources"], maxSteps: 4 },
  screen: { mode: "single", tools: ["classify-intent"], skills: [] },
  build: { mode: "single", tools: [], skills: ["brand-voice"] },
  coach: { mode: "loop", tools: ["lookup-role", "fetch-transcript"], skills: [], maxSteps: 6 },
  negotiate: { mode: "loop", tools: ["lookup-comp-band", "policy-check"], skills: [], maxSteps: 4 },
  "ask-pulse": { mode: "loop", tools: ["search-survey"], skills: ["cite-sources"], maxSteps: 3 },
  ask: { mode: "loop", tools: ["search-kb", "fetch-doc"], skills: ["cite-sources"], maxSteps: 4 },
  detect: { mode: "single", tools: ["classify-intent"], skills: [] },
};

/** Guardrails config per use case. Floors reference the use case's inline eval keys. */
const SAMPLE_GUARDRAILS: Record<string, UseCaseProfile["guardrails"]> = {
  penny_categorize: { pii: true, piiAction: "redact", injectionGuard: true, floors: ["pii-block"] },
  penny_insights: {
    pii: true,
    piiAction: "block",
    injectionGuard: true,
    hitlThreshold: 0.7,
    floors: ["numeric-fidelity", "no-advice"],
  },
  match: { pii: true, piiAction: "redact", injectionGuard: true, floors: ["grounding"] },
  screen: { pii: true, piiAction: "block", injectionGuard: true, hitlThreshold: 0.6, floors: ["pii-block"] },
  build: { pii: false, injectionGuard: true, floors: ["no-bias"] },
  coach: { pii: true, piiAction: "redact", injectionGuard: true, floors: ["pii-block"] },
  negotiate: {
    pii: true,
    piiAction: "block",
    injectionGuard: true,
    hitlThreshold: 0.8,
    floors: ["band-fidelity", "no-advice"],
  },
  "ask-pulse": { pii: true, piiAction: "redact", injectionGuard: true, floors: ["grounding"] },
  ask: { pii: false, injectionGuard: true, floors: ["grounding"] },
  detect: { pii: false, injectionGuard: true, floors: ["verdict-schema"] },
};

/** System prompt reference per use case, resolved against the prompt registry. */
function systemRef(useCaseId: string): string {
  return `${useCaseId}.system`;
}

function evalsForUseCase(useCaseId: string): UseCaseProfile["evals"] {
  const setup = EVAL_SETUP.find((s) => s.useCaseId === useCaseId);
  if (!setup) return [];
  return setup.gates.map((g) => ({
    key: g.id,
    method: g.method,
    floor: g.kind === "inline",
    mandatory: true,
    when: g.kind,
  }));
}

function sloForUseCase(useCaseId: string): UseCaseProfile["slo"] {
  return SLO_TARGETS[useCaseId] ?? {};
}

/**
 * Sample use case profiles. Each profile is the single config object per use
 * case: routing, retrieval, agent, prompt, guardrails, evals, and SLOs. Every
 * value is placeholder configuration for demonstration, not a live measurement.
 */
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
    prompt: { systemRef: systemRef(u.id) },
    guardrails: SAMPLE_GUARDRAILS[u.id] ?? {},
    evals: evalsForUseCase(u.id),
    slo: sloForUseCase(u.id),
  };
});

export function sampleProfile(useCaseId: string): UseCaseProfile | undefined {
  return SAMPLE_PROFILES.find((p) => p.id === useCaseId);
}
