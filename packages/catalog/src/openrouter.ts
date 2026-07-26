/**
 * The live OpenRouter side of the catalog: fetch the public models list and
 * normalize each record into the one `CatalogModel` shape.
 *
 * Fetch is injected so the same code runs in a Worker, in Node, and under a
 * mock in tests. The network response is treated as untrusted: every field is
 * read defensively and coerced to the normalized shape.
 */
import type {
  CatalogFetch,
  CatalogModel,
  FetchOpenRouterOptions,
  OpenRouterListResponse,
  OpenRouterModel,
} from "./types.ts";

export const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

/** Raised when the OpenRouter models endpoint answers with a non-ok status. */
export class OpenRouterFetchError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`OpenRouter models request failed with status ${status}`);
    this.name = "OpenRouterFetchError";
    this.status = status;
    this.body = body;
  }
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Normalize a single raw OpenRouter record. Prices arrive as USD-per-token
 * strings, so they are multiplied by 1e6 to per-million. Sampling support is
 * derived from `supported_parameters` including "temperature"; tool support
 * from it including "tools".
 */
export function normalizeOpenRouterModel(raw: OpenRouterModel): CatalogModel {
  const params = strArray(raw.supported_parameters);
  const inputModalities = strArray(raw.architecture?.input_modalities);
  const outputModalities = strArray(raw.architecture?.output_modalities);
  return {
    ref: `openrouter/${raw.id}`,
    id: raw.id,
    name: typeof raw.name === "string" && raw.name.length > 0 ? raw.name : raw.id,
    provider: "openrouter",
    contextLength: num(raw.context_length),
    promptPerMTok: num(raw.pricing?.prompt) * 1e6,
    completionPerMTok: num(raw.pricing?.completion) * 1e6,
    inputModalities: inputModalities.length > 0 ? inputModalities : ["text"],
    outputModalities: outputModalities.length > 0 ? outputModalities : ["text"],
    supportsSampling: params.includes("temperature"),
    supportsTools: params.includes("tools"),
  };
}

/**
 * GET the OpenRouter models list and normalize it. Injects `fetchImpl` so no
 * global fetch is assumed. A non-ok response throws `OpenRouterFetchError`.
 */
export async function fetchOpenRouterModels(
  fetchImpl: CatalogFetch,
  options: FetchOpenRouterOptions = {},
): Promise<CatalogModel[]> {
  const endpoint = options.endpoint ?? OPENROUTER_MODELS_ENDPOINT;
  const headers: Record<string, string> = {};
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const res = await fetchImpl(endpoint, { headers });
  if (!res.ok) {
    let body = "";
    try {
      body = res.text ? await res.text() : "";
    } catch {
      body = "";
    }
    throw new OpenRouterFetchError(res.status, body);
  }

  const payload = (await res.json()) as OpenRouterListResponse;
  const data = Array.isArray(payload?.data) ? payload.data : [];
  return data.map(normalizeOpenRouterModel);
}
