/**
 * @conduit/profile public surface.
 *
 * The unified use case profile plus the pluggable registries and the store
 * backed resolver and validator. This is the foundation that makes Conduit
 * config driven per use case. Four follow up workstreams (evals, prompts and
 * guardrails, RAG, agent) each fill in the sub section they own and register
 * their implementations into the shared registries.
 */
export {
  Registry,
  methodRegistry,
  retrieverRegistry,
  toolRegistry,
  skillRegistry,
  promptRegistry,
  providerRegistry,
} from "./registry.ts";

export { InMemoryProfileStore } from "./store.ts";
export { applyDefaults, resolveProfile } from "./resolve.ts";
export { validateProfile } from "./validate.ts";

export {
  chunkDoc,
  getRetrieverBuilder,
  resolveRetriever,
  retrieveFor,
  RETRIEVER_NAMES,
} from "./retrieval.ts";
export type {
  ResolvedRetriever,
  RetrieveForResult,
  RetrieverBuilder,
  RetrieverDeps,
  RetrieverName,
} from "./retrieval.ts";

export type {
  AgentConfig,
  ChunkingConfig,
  EvalBinding,
  EvalWhen,
  GuardrailsConfig,
  PartialProfile,
  ProfileStore,
  PromptConfig,
  RetrievalConfig,
  RoutingConfig,
  SloConfig,
  UseCaseProfile,
  ValidationIssue,
} from "./types.ts";
