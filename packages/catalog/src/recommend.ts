/**
 * Use-case-aware surfacing over the merged catalog.
 *
 * `recommendForUseCase` is a transparent, documented heuristic, NOT a quality
 * benchmark. It filters the catalog to models that can actually serve the use
 * case (text output, and tools / long context when the profile requires them),
 * then orders them by a single explicit signal. When costSensitivity is "high"
 * it lists the cheapest prompt price first. When costSensitivity is "low" it
 * uses a capability proxy: longest context first, then more expensive first
 * (price used only as a rough capability tiebreak). No model quality scores or
 * eval results are consulted here.
 */
import type { CatalogModel, UseCaseProfile } from "./types.ts";

const LONG_CONTEXT_MIN = 128000;
const DEFAULT_LIMIT = 8;

/** Merge live OpenRouter models with the curated entries into one list. */
export function mergeCatalog(
  openrouterModels: CatalogModel[],
  curated: CatalogModel[],
): CatalogModel[] {
  return [...openrouterModels, ...curated];
}

/**
 * Rank models for a use case and return the top refs (default up to 8).
 * See the module comment: this is a cost / capability heuristic, not a quality
 * ranking.
 */
export function recommendForUseCase(
  models: CatalogModel[],
  profile: UseCaseProfile,
  limit: number = DEFAULT_LIMIT,
): string[] {
  const eligible = models.filter((m) => {
    if (!m.outputModalities.includes("text")) return false;
    if (profile.needsTools && !m.supportsTools) return false;
    if (profile.needsLongContext && m.contextLength < LONG_CONTEXT_MIN) return false;
    return true;
  });

  const ranked = [...eligible].sort((a, b) => {
    if (profile.costSensitivity === "high") {
      // Cheapest first. Prompt price is the tiebreaker-free primary signal.
      if (a.promptPerMTok !== b.promptPerMTok) return a.promptPerMTok - b.promptPerMTok;
      return b.contextLength - a.contextLength;
    }
    // "low": prefer capability. Longer context first, then higher price as a
    // rough proxy for a more capable tier.
    if (a.contextLength !== b.contextLength) return b.contextLength - a.contextLength;
    return b.promptPerMTok - a.promptPerMTok;
  });

  return ranked.slice(0, Math.max(0, limit)).map((m) => m.ref);
}

/**
 * Per-use-case profiles for the platform's standard use cases. Shared by the
 * gateway endpoint and the console so both surface models the same way. Keys
 * match the console use case ids.
 */
export const USE_CASE_PROFILES: Record<string, UseCaseProfile> = {
  "support-triage": { task: "bulk", costSensitivity: "high" },
  "kb-search": { task: "grounded", costSensitivity: "low", needsLongContext: true },
  "sales-draft": { task: "draft", costSensitivity: "high" },
  "billing-summary": { task: "financial", costSensitivity: "low", needsTools: true },
  "code-review": { task: "code", costSensitivity: "low", needsTools: true, needsLongContext: true },
};
