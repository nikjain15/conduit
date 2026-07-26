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
import type { FetchLike, HttpResponseLike } from "@conduit/client";
import { COST_TREND, MODEL_CONFIG, modelLabel } from "./sample.ts";

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
