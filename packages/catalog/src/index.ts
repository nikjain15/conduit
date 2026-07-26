/**
 * @conduit/catalog public surface.
 *
 * The normalized model catalog: live OpenRouter models plus curated managed and
 * edge entries in one `CatalogModel` shape, and a transparent use-case-aware
 * recommender over the merged list.
 */
export type {
  CatalogModel,
  CatalogProvider,
  OpenRouterModel,
  OpenRouterListResponse,
  UseCaseProfile,
  CatalogFetch,
  CatalogFetchResponse,
  FetchOpenRouterOptions,
} from "./types.ts";

export {
  fetchOpenRouterModels,
  normalizeOpenRouterModel,
  OpenRouterFetchError,
  OPENROUTER_MODELS_ENDPOINT,
} from "./openrouter.ts";

export {
  ANTHROPIC_MODELS,
  WORKERS_AI_MODELS,
  CURATED_MODELS,
} from "./curated.ts";

export {
  mergeCatalog,
  recommendForUseCase,
  USE_CASE_PROFILES,
} from "./recommend.ts";
