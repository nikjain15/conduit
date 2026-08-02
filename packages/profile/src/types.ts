/**
 * The unified use case profile.
 *
 * A UseCaseProfile is the single config object that makes Conduit config driven
 * per use case. Every sub section is declared here so the follow up workstreams
 * (evals, prompts and guardrails, RAG, agent) each have a stable home to fill
 * in. Deep behaviour lands later; this file only fixes the shape.
 *
 * The types are intentionally self contained: the profile package describes
 * configuration, it does not execute it. Executors resolve a profile and read
 * the sub section they own.
 */

/** How a request is routed to a model for this use case. */
export interface RoutingConfig {
  /** Primary model ref, provider prefixed, for example "anthropic/claude-opus-4-8". */
  main: string;
  /** Fallback model ref used when the cap is hit or the main model fails. */
  backup?: string;
  /** Monthly spend cap in USD before routing falls back to the backup. */
  capUsd?: number;
  /** Whether an equivalent prior answer may be reused. */
  cache?: boolean;
}

/** Fixed size chunking parameters for the retrieval source. */
export interface ChunkingConfig {
  size: number;
  overlap: number;
}

/** Grounded retrieval configuration. Filled in by the RAG workstream. */
export interface RetrievalConfig {
  /** Identifier of the corpus or index this use case retrieves from. */
  source: string;
  chunking?: ChunkingConfig;
  embedModel?: string;
  topK?: number;
  /** Minimum grounding score an answer must clear to be served. */
  groundingThreshold?: number;
}

/** Agent loop configuration. Filled in by the agent workstream. */
export interface AgentConfig {
  /** "single" is one shot; "loop" runs a tool use loop up to maxSteps. */
  mode: "single" | "loop";
  tools: string[];
  skills: string[];
  maxSteps?: number;
}

/** Prompt assembly configuration. Filled in by the prompts workstream. */
export interface PromptConfig {
  /** Reference into the prompt registry for the system prompt. */
  systemRef: string;
  templates?: Record<string, string>;
  variables?: Record<string, string>;
}

/** Safety and policy configuration. Filled in by the guardrails workstream. */
export interface GuardrailsConfig {
  pii?: boolean;
  /** What to do on a PII hit: mask the matches ("redact") or refuse ("block").
   *  Defaults to "redact" when pii is on and this is unset. */
  piiAction?: "redact" | "block";
  injectionGuard?: boolean;
  /** Schema the output must conform to, shape defined by the guardrails workstream. */
  outputSchema?: unknown;
  /** Confidence below which a human in the loop review is required. */
  hitlThreshold?: number;
  /** Named non negotiable floors that always apply. */
  floors?: string[];
  /**
   * What happens to a request the engine decides to refuse.
   *
   * "refuse" (the default) returns a refusal. "review" turns the refusal into an
   * escalation: the answer is still withheld, but the request routes to a human
   * instead of dying. Exists because a wrongly blocked request otherwise has no
   * recovery path short of editing the pattern set and redeploying.
   */
  blockedRequestAction?: "refuse" | "review";
}

/** When an eval runs relative to a live request. */
export type EvalWhen = "inline" | "batch";

/** One eval gate binding. Filled in by the evals workstream. */
export interface EvalBinding {
  key: string;
  /** Method name resolved against the method registry. */
  method: string;
  params?: Record<string, unknown>;
  /** Pass threshold, numeric or an expression the method understands. */
  threshold?: number | string;
  /** Whether this gate is a non negotiable floor. */
  floor?: boolean;
  /** Whether a failure blocks the release or response. */
  mandatory?: boolean;
  /** "inline" runs on every call; "batch" runs against a labelled set. */
  when: EvalWhen;
}

/** Service level objectives: service, quality, and spend targets. */
export interface SloConfig {
  p95LatencyMs?: number;
  costPerAnswerUsd?: number;
  gateBlockRate?: number;
}

/**
 * The unified config object for one use case in one tenant. Only id, name,
 * tenant, and routing.main are required in practice; the resolver fills the
 * rest with defaults so a partial profile is valid.
 */
export interface UseCaseProfile {
  id: string;
  name: string;
  tenant: string;
  routing: RoutingConfig;
  retrieval?: RetrievalConfig | null;
  agent?: AgentConfig;
  prompt?: PromptConfig;
  guardrails?: GuardrailsConfig;
  evals?: EvalBinding[];
  slo?: SloConfig;
}

/**
 * A partial profile as authored or persisted. The resolver accepts this and
 * returns a fully defaulted UseCaseProfile.
 */
export type PartialProfile =
  & Partial<Omit<UseCaseProfile, "routing">>
  & { routing?: Partial<RoutingConfig> };

/**
 * Persistence boundary for profiles. The resolver reads through this so the
 * store can be in memory, a KV namespace, or a database without changing
 * resolution logic.
 */
export interface ProfileStore {
  get(tenant: string, id: string): Promise<PartialProfile | null>;
  list(tenant: string): Promise<PartialProfile[]>;
  put(profile: UseCaseProfile): Promise<void>;
}

/** One structural problem found by validateProfile. */
export interface ValidationIssue {
  /** Dotted path to the offending field, for example "evals[0].when". */
  path: string;
  message: string;
}
