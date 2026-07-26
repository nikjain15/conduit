/**
 * Public types for @conduit/catalog.
 *
 * The catalog is the single normalized view of every model Conduit can route
 * to, whether it comes live from OpenRouter or from a small curated list of
 * managed and edge providers. Everything downstream (the gateway endpoint, the
 * console dropdowns) reads this one `CatalogModel` shape and nothing else.
 */

/** Providers the inference core can route to. Mirrors @conduit/inference. */
export type CatalogProvider = "openrouter" | "anthropic" | "workers-ai";

/**
 * One routable model, normalized across providers.
 *
 * Prices are USD per million tokens (the OpenRouter API reports per token; the
 * normalizer multiplies by 1e6). `ref` is the provider-prefixed id the rest of
 * Conduit routes on, e.g. "openrouter/meta-llama/llama-3.3-70b-instruct".
 */
export interface CatalogModel {
  ref: string;
  id: string;
  name: string;
  provider: CatalogProvider;
  contextLength: number;
  promptPerMTok: number;
  completionPerMTok: number;
  inputModalities: string[];
  outputModalities: string[];
  /** True when the model accepts temperature / top_p / top_k sampling params. */
  supportsSampling: boolean;
  /** True when the model can be called with tool / function definitions. */
  supportsTools: boolean;
}

/** The raw OpenRouter model record, from GET /api/v1/models `data[]`. */
export interface OpenRouterModel {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  supported_parameters?: string[];
}

/** The raw OpenRouter list response. */
export interface OpenRouterListResponse {
  data: OpenRouterModel[];
}

/**
 * A use case's routing intent, used to surface the right models.
 *
 * `task` is descriptive metadata for the caller; ranking is driven by
 * `costSensitivity` and the two capability filters. See `recommendForUseCase`.
 */
export interface UseCaseProfile {
  task: "bulk" | "grounded" | "draft" | "financial" | "code";
  costSensitivity: "high" | "low";
  needsTools?: boolean;
  needsLongContext?: boolean;
}

/** Minimal fetch signature so any spec-compatible fetch (or a mock) is accepted. */
export interface CatalogFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export type CatalogFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<CatalogFetchResponse>;

/** Options for `fetchOpenRouterModels`. */
export interface FetchOpenRouterOptions {
  apiKey?: string;
  /** Override the endpoint, mainly for tests. Defaults to the public API. */
  endpoint?: string;
}
