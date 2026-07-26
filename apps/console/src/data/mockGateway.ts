/**
 * Local mock adapter for the conduit gateway.
 *
 * It fulfils the same HTTP contract the real conduit-gateway serves, so the
 * console can run as a static site with no backend. The console builds a
 * `@conduit/client` in gateway mode and injects this fetch in place of the
 * global one. Swapping in the real transport is a one line change in client.ts.
 *
 * Responses are sample data. Nothing here is a live measurement.
 */
import type { FetchLike, HttpResponseLike, UseCaseProfile } from "@conduit/client";
import {
  CURATED_MODELS,
  mergeCatalog,
  normalizeOpenRouterModel,
  recommendForUseCase,
  USE_CASE_PROFILES,
} from "@conduit/catalog";
import { COST_TREND, MODEL_CONFIG, modelLabel, SAMPLE_PROFILES } from "./sample.ts";
import { OPENROUTER_SNAPSHOT } from "./openrouterSnapshot.ts";

/** The merged catalog the mock serves: the sample OpenRouter snapshot plus the
 *  curated managed and edge entries, normalized the same way the gateway does. */
const MOCK_CATALOG = mergeCatalog(
  OPENROUTER_SNAPSHOT.map(normalizeOpenRouterModel),
  CURATED_MODELS,
);

/**
 * A mutable in-memory copy of the sample profiles. Edits from the Eval setup
 * editor round-trip through a PUT and land here, so a later GET reflects them
 * for the life of the page. Seeded from the read-only sample data.
 */
const PROFILE_STORE: UseCaseProfile[] = SAMPLE_PROFILES.map((p) => ({ ...p }));

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Latest month spend per use case, summed across the trend series. */
function latestUsage(): { totalCostUsd: number; byUseCase: Record<string, number> } {
  const byUseCase: Record<string, number> = {};
  let total = 0;
  for (const [useCaseId, series] of Object.entries(COST_TREND)) {
    const latest = series[series.length - 1] ?? 0;
    byUseCase[useCaseId] = latest;
    total += latest;
  }
  return { totalCostUsd: total, byUseCase };
}

/**
 * A FetchLike matching @conduit/client. It routes the gateway paths the client
 * calls and returns sample payloads shaped like the real wire contract.
 */
export const mockGatewayFetch: FetchLike = async (url, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];

  if (method === "GET" && path === "/v1/usage") {
    return jsonResponse(latestUsage());
  }

  if (method === "GET" && path === "/v1/models") {
    const query = url.split("?")[1] ?? "";
    const useCase = new URLSearchParams(query).get("useCase");
    if (!useCase) return jsonResponse({ models: MOCK_CATALOG });
    const profile = USE_CASE_PROFILES[useCase];
    const recommended = profile ? recommendForUseCase(MOCK_CATALOG, profile) : [];
    return jsonResponse({ models: MOCK_CATALOG, recommended });
  }

  if (method === "GET" && path === "/v1/profiles") {
    const query = url.split("?")[1] ?? "";
    const useCase = new URLSearchParams(query).get("useCase");
    const profiles = useCase
      ? PROFILE_STORE.filter((p) => p.id === useCase)
      : PROFILE_STORE;
    return jsonResponse({ profiles });
  }

  if (method === "PUT" && path.startsWith("/v1/profiles/")) {
    const id = decodeURIComponent(path.slice("/v1/profiles/".length));
    const updated = init?.body ? (JSON.parse(init.body) as UseCaseProfile) : null;
    if (!updated || updated.id !== id) {
      return jsonResponse({ error: "profile id mismatch" }, 400);
    }
    const idx = PROFILE_STORE.findIndex((p) => p.id === id);
    if (idx === -1) return jsonResponse({ error: `no profile ${id}` }, 404);
    PROFILE_STORE[idx] = updated;
    return jsonResponse(updated);
  }

  if (method === "POST" && path === "/v1/infer") {
    const body = init?.body ? (JSON.parse(init.body) as { useCase?: string; pinModel?: { provider: string; model: string } }) : {};
    const useCase = body.useCase ?? "support-triage";
    const cfg = MODEL_CONFIG.find((c) => c.useCaseId === useCase);
    const ref = body.pinModel
      ? `${body.pinModel.provider}/${body.pinModel.model}`
      : cfg?.mainModel ?? "anthropic/claude-haiku-4-5";
    const [provider, model] = ref.split("/");
    return jsonResponse({
      output: `Sample response from ${modelLabel(ref)} for the ${useCase} use case. This is placeholder text from the mock gateway.`,
      model,
      provider,
      costUsd: 0.0042,
      latencyMs: 1180,
      decisionId: "sample-decision",
    });
  }

  return jsonResponse({ error: `mock gateway has no route for ${method} ${path}` }, 404);
};
