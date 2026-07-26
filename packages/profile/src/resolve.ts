/**
 * Resolve a profile from a store and apply defaults.
 *
 * A stored profile may be partial: an author sets routing.main and leaves the
 * rest off. resolveProfile reads the record through the injected store and
 * returns a fully populated UseCaseProfile so every executor can read its sub
 * section without null checks. Defaults are conservative: no retrieval, a
 * single shot agent with no tools, an empty prompt, guardrails off, no evals,
 * and an empty SLO block.
 */
import type {
  PartialProfile,
  ProfileStore,
  UseCaseProfile,
} from "./types.ts";

/** Baseline routing when a stored profile omits it entirely. */
const DEFAULT_MAIN_MODEL = "anthropic/claude-haiku-4-5";

/** Merge a partial profile onto defaults, producing a complete profile. */
export function applyDefaults(
  partial: PartialProfile,
  tenant: string,
  id: string,
): UseCaseProfile {
  return {
    id: partial.id ?? id,
    name: partial.name ?? id,
    tenant: partial.tenant ?? tenant,
    routing: {
      main: partial.routing?.main ?? DEFAULT_MAIN_MODEL,
      backup: partial.routing?.backup,
      capUsd: partial.routing?.capUsd,
      cache: partial.routing?.cache ?? false,
    },
    retrieval: partial.retrieval ?? null,
    agent: partial.agent ?? { mode: "single", tools: [], skills: [] },
    prompt: partial.prompt ?? { systemRef: "" },
    guardrails: partial.guardrails ?? {},
    evals: partial.evals ?? [],
    slo: partial.slo ?? {},
  };
}

/**
 * Read a profile for a tenant and use case, applying defaults. When the store
 * has no record, a default profile is returned so callers always get a usable
 * config. Never throws for a missing record; the store may still reject.
 */
export async function resolveProfile(
  store: ProfileStore,
  tenant: string,
  useCaseId: string,
): Promise<UseCaseProfile> {
  const stored = await store.get(tenant, useCaseId);
  return applyDefaults(stored ?? {}, tenant, useCaseId);
}
