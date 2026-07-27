/**
 * Local mock adapter for the conduit gateway.
 *
 * It fulfils the same HTTP contract the real conduit-gateway serves, so the
 * console can run as a static site with no backend. The console builds a
 * `@conduit/client` in gateway mode and injects this fetch in place of the
 * global one. Swapping in the real transport is a one line change in client.ts.
 *
 * Live telemetry (usage, suqs) is backed by an in-memory decision store that
 * starts EMPTY. With no real gateway and no real traffic there is nothing to
 * measure, so the offline console renders its honest "no live data yet" state
 * rather than invented dollars. A reported decision (POST /v1/decisions) appends
 * to this store, after which usage and suqs reflect it. The catalog and profile
 * routes still serve sample configuration, which is labelled as sample in the UI.
 */
import type {
  FetchLike,
  HttpResponseLike,
  ReportDecisionParams,
  SuqsApp,
  SuqsResult,
  SuqsRow,
  UsageApp,
  UsageResult,
  UseCaseProfile,
} from "@conduit/client";
import {
  CURATED_MODELS,
  mergeCatalog,
  normalizeOpenRouterModel,
  recommendForUseCase,
} from "@conduit/catalog";
import {
  appLabelOf,
  appOfUseCase,
  MODEL_CONFIG,
  modelLabel,
  SAMPLE_PROFILES,
  USE_CASE_RECO,
} from "./sample.ts";
import { OPENROUTER_SNAPSHOT } from "./openrouterSnapshot.ts";

/** The merged catalog the mock serves: the sample OpenRouter snapshot plus the
 *  curated managed and edge entries, normalized the same way the gateway does. */
const MOCK_CATALOG = mergeCatalog(
  OPENROUTER_SNAPSHOT.map(normalizeOpenRouterModel),
  CURATED_MODELS,
);

/**
 * A mutable in-memory copy of the sample profiles. Edits from the config
 * editors round-trip through a PUT and land here, so a later GET reflects them
 * for the life of the page. Seeded from the read-only sample data.
 */
const PROFILE_STORE: UseCaseProfile[] = SAMPLE_PROFILES.map((p) => ({ ...p }));

/**
 * The metered decision store. It starts EMPTY on purpose: the offline console
 * has no live gateway behind it, so there is genuinely no measured data to show.
 * Reported decisions are appended here.
 */
interface StoredDecision {
  app: string;
  appLabel: string;
  useCase: string;
  model: string;
  provider?: string;
  costUsd: number;
  latencyMs: number;
  gateStatus?: "pass" | "block";
  at: number;
}
const DECISION_STORE: StoredDecision[] = [];

/** Reset the store to empty. Exposed for tests that assert the empty state. */
export function resetMockDecisions(): void {
  DECISION_STORE.length = 0;
}

function jsonResponse(body: unknown, status = 200): HttpResponseLike {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(Math.max(rank, 1), sorted.length) - 1;
  return sorted[idx];
}

/** Bucket the reported decisions by app id, keeping a label per app. */
function groupByApp(): Map<string, { label: string; rows: StoredDecision[] }> {
  const groups = new Map<string, { label: string; rows: StoredDecision[] }>();
  for (const d of DECISION_STORE) {
    const entry = groups.get(d.app) ?? { label: d.appLabel, rows: [] };
    entry.rows.push(d);
    groups.set(d.app, entry);
  }
  return groups;
}

/** Aggregate the real (reported) decisions into the usage wire shape, grouped
 *  by app then use case. Empty in, empty out: no records yields
 *  `{ totalCostUsd: 0, byApp: [] }`. */
function aggregateUsage(): UsageResult {
  let totalCostUsd = 0;
  for (const d of DECISION_STORE) totalCostUsd += d.costUsd;

  const byApp: UsageApp[] = [...groupByApp().entries()]
    .map(([app, { label, rows }]) => {
      const byUseCase = new Map<string, number>();
      let appTotal = 0;
      for (const d of rows) {
        appTotal += d.costUsd;
        byUseCase.set(d.useCase, round6((byUseCase.get(d.useCase) ?? 0) + d.costUsd));
      }
      const useCases = [...byUseCase.entries()]
        .map(([useCase, costUsd]) => ({ useCase, costUsd }))
        .sort((a, b) => a.useCase.localeCompare(b.useCase));
      return { app, appLabel: label, totalCostUsd: round6(appTotal), useCases };
    })
    .sort((a, b) => a.app.localeCompare(b.app));

  return { totalCostUsd: round6(totalCostUsd), byApp };
}

/** Compute SUQS metrics from the real decisions grouped by app then use case,
 *  attaching the sample profile SLO target per use case. Empty when there are
 *  no records. */
function computeSuqs(): SuqsResult {
  const byApp: SuqsApp[] = [...groupByApp().entries()]
    .map(([app, { label, rows }]) => {
      const byUseCase = new Map<string, StoredDecision[]>();
      for (const d of rows) {
        const list = byUseCase.get(d.useCase) ?? [];
        list.push(d);
        byUseCase.set(d.useCase, list);
      }
      const useCases: SuqsRow[] = [...byUseCase.entries()]
        .map(([useCase, ucRows]) => {
          const calls = ucRows.length;
          const totalCost = ucRows.reduce((sum, d) => sum + d.costUsd, 0);
          const blocked = ucRows.filter((d) => d.gateStatus === "block").length;
          const slo = PROFILE_STORE.find((p) => p.id === useCase)?.slo;
          return {
            useCase,
            calls,
            p95LatencyMs: percentile(ucRows.map((d) => d.latencyMs), 95),
            costPerAnswerUsd: round6(totalCost / calls),
            gateBlockRate: round6(blocked / calls),
            target: slo ?? null,
          };
        })
        .sort((a, b) => a.useCase.localeCompare(b.useCase));
      return { app, appLabel: label, useCases };
    })
    .sort((a, b) => a.app.localeCompare(b.app));

  return { byApp };
}

/**
 * A FetchLike matching @conduit/client. It routes the gateway paths the client
 * calls and returns payloads shaped like the real wire contract.
 */
export const mockGatewayFetch: FetchLike = async (url, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];

  if (method === "GET" && path === "/v1/usage") {
    return jsonResponse(aggregateUsage());
  }

  if (method === "GET" && path === "/v1/suqs") {
    return jsonResponse(computeSuqs());
  }

  if (method === "POST" && path === "/v1/decisions") {
    const body = init?.body ? (JSON.parse(init.body) as ReportDecisionParams) : null;
    if (!body || typeof body.useCase !== "string" || typeof body.model !== "string") {
      return jsonResponse({ error: "invalid decision" }, 400);
    }
    // The app is derived here from the use case, mirroring how the real gateway
    // derives it from the caller's token rather than from the request body: a
    // client-supplied app would be ignored either way.
    const app = appOfUseCase(body.useCase);
    DECISION_STORE.push({
      app,
      appLabel: appLabelOf(app),
      useCase: body.useCase,
      model: body.model,
      provider: body.provider,
      costUsd: body.costUsd,
      latencyMs: body.latencyMs,
      gateStatus: body.gateStatus,
      at: body.at ?? Date.now(),
    });
    return jsonResponse({ accepted: true, tenant: "org:example" }, 202);
  }

  if (method === "GET" && path === "/v1/models") {
    const query = url.split("?")[1] ?? "";
    const useCase = new URLSearchParams(query).get("useCase");
    if (!useCase) return jsonResponse({ models: MOCK_CATALOG });
    const profile = USE_CASE_RECO[useCase];
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
    const useCase = body.useCase ?? "penny_categorize";
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
