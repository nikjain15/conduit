/**
 * @conduit/catalog tests. Pure logic only: a mocked fetch, no live network.
 * Each test asserts real normalization, filtering, ordering, and merge behavior.
 */
import { describe, it, expect } from "vitest";
import {
  fetchOpenRouterModels,
  OpenRouterFetchError,
  mergeCatalog,
  recommendForUseCase,
  CURATED_MODELS,
  ANTHROPIC_MODELS,
  WORKERS_AI_MODELS,
} from "../src/index.ts";
import type {
  CatalogFetch,
  CatalogFetchResponse,
  CatalogModel,
  OpenRouterModel,
} from "../src/index.ts";

function okResponse(body: unknown): CatalogFetchResponse {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errResponse(status: number, text: string): CatalogFetchResponse {
  return {
    ok: false,
    status,
    json: async () => ({ error: text }),
    text: async () => text,
  };
}

const RAW_A: OpenRouterModel = {
  id: "meta-llama/llama-3.3-70b-instruct",
  name: "Llama 3.3 70B Instruct",
  pricing: { prompt: "0.00000059", completion: "0.00000079" },
  context_length: 131072,
  architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
  supported_parameters: ["temperature", "top_p", "tools", "response_format"],
};

const RAW_B: OpenRouterModel = {
  id: "openai/o-reasoner",
  name: "O Reasoner",
  pricing: { prompt: "0.000005", completion: "0.000015" },
  context_length: 200000,
  architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
  // No "temperature" -> sampling unsupported. No "tools" -> tools unsupported.
  supported_parameters: ["response_format"],
};

describe("fetchOpenRouterModels normalization", () => {
  it("maps fields and converts per-token prices to per-million", async () => {
    const fetchImpl: CatalogFetch = async () => okResponse({ data: [RAW_A] });
    const [m] = await fetchOpenRouterModels(fetchImpl);
    expect(m.ref).toBe("openrouter/meta-llama/llama-3.3-70b-instruct");
    expect(m.id).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(m.name).toBe("Llama 3.3 70B Instruct");
    expect(m.provider).toBe("openrouter");
    expect(m.contextLength).toBe(131072);
    expect(m.promptPerMTok).toBeCloseTo(0.59, 6);
    expect(m.completionPerMTok).toBeCloseTo(0.79, 6);
    expect(m.inputModalities).toEqual(["text"]);
    expect(m.outputModalities).toEqual(["text"]);
    expect(m.supportsTools).toBe(true);
  });

  it("derives supportsSampling from supported_parameters", async () => {
    const fetchImpl: CatalogFetch = async () => okResponse({ data: [RAW_A, RAW_B] });
    const [withTemp, withoutTemp] = await fetchOpenRouterModels(fetchImpl);
    expect(withTemp.supportsSampling).toBe(true);
    expect(withoutTemp.supportsSampling).toBe(false);
    expect(withoutTemp.supportsTools).toBe(false);
  });

  it("passes an Authorization header only when an apiKey is given", async () => {
    const seen: Array<Record<string, string> | undefined> = [];
    const fetchImpl: CatalogFetch = async (_url, init) => {
      seen.push(init?.headers);
      return okResponse({ data: [] });
    };
    await fetchOpenRouterModels(fetchImpl);
    await fetchOpenRouterModels(fetchImpl, { apiKey: "sk-test" });
    expect(seen[0]).toEqual({});
    expect(seen[1]).toEqual({ Authorization: "Bearer sk-test" });
  });

  it("throws a structured error on a non-ok response", async () => {
    const fetchImpl: CatalogFetch = async () => errResponse(429, "rate limited");
    await expect(fetchOpenRouterModels(fetchImpl)).rejects.toBeInstanceOf(OpenRouterFetchError);
    try {
      await fetchOpenRouterModels(fetchImpl);
    } catch (err) {
      const e = err as OpenRouterFetchError;
      expect(e.status).toBe(429);
      expect(e.body).toBe("rate limited");
    }
  });
});

describe("recommendForUseCase", () => {
  function catalog(): CatalogModel[] {
    return mergeCatalog(
      [
        {
          ref: "openrouter/cheap-small",
          id: "cheap-small",
          name: "Cheap Small",
          provider: "openrouter",
          contextLength: 8000,
          promptPerMTok: 0.1,
          completionPerMTok: 0.2,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsSampling: true,
          supportsTools: false,
        },
        {
          ref: "openrouter/mid-tools",
          id: "mid-tools",
          name: "Mid Tools",
          provider: "openrouter",
          contextLength: 131072,
          promptPerMTok: 0.6,
          completionPerMTok: 0.8,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsSampling: true,
          supportsTools: true,
        },
        {
          ref: "openrouter/pricey-long",
          id: "pricey-long",
          name: "Pricey Long",
          provider: "openrouter",
          contextLength: 200000,
          promptPerMTok: 5,
          completionPerMTok: 15,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsSampling: false,
          supportsTools: true,
        },
        {
          ref: "openrouter/image-only",
          id: "image-only",
          name: "Image Only",
          provider: "openrouter",
          contextLength: 8000,
          promptPerMTok: 0.05,
          completionPerMTok: 0,
          inputModalities: ["text"],
          outputModalities: ["image"],
          supportsSampling: true,
          supportsTools: false,
        },
      ],
      [],
    );
  }

  it("filters out non-text output models", () => {
    const refs = recommendForUseCase(catalog(), { task: "bulk", costSensitivity: "high" });
    expect(refs).not.toContain("openrouter/image-only");
  });

  it("orders cheapest first for high cost sensitivity", () => {
    const refs = recommendForUseCase(catalog(), { task: "bulk", costSensitivity: "high" });
    expect(refs).toEqual(["openrouter/cheap-small", "openrouter/mid-tools", "openrouter/pricey-long"]);
  });

  it("orders by capability (context desc) for low cost sensitivity", () => {
    const refs = recommendForUseCase(catalog(), { task: "grounded", costSensitivity: "low" });
    expect(refs).toEqual(["openrouter/pricey-long", "openrouter/mid-tools", "openrouter/cheap-small"]);
  });

  it("requires tools when needsTools is set", () => {
    const refs = recommendForUseCase(catalog(), { task: "code", costSensitivity: "high", needsTools: true });
    expect(refs).not.toContain("openrouter/cheap-small");
    expect(refs).toContain("openrouter/mid-tools");
    expect(refs).toContain("openrouter/pricey-long");
  });

  it("requires long context when needsLongContext is set", () => {
    const refs = recommendForUseCase(catalog(), {
      task: "grounded",
      costSensitivity: "low",
      needsLongContext: true,
    });
    expect(refs).toEqual(["openrouter/pricey-long", "openrouter/mid-tools"]);
  });

  it("caps the result length", () => {
    const many: CatalogModel[] = Array.from({ length: 20 }, (_, i) => ({
      ref: `openrouter/m${i}`,
      id: `m${i}`,
      name: `M${i}`,
      provider: "openrouter" as const,
      contextLength: 1000 + i,
      promptPerMTok: i,
      completionPerMTok: i,
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsSampling: true,
      supportsTools: true,
    }));
    expect(recommendForUseCase(many, { task: "bulk", costSensitivity: "high" })).toHaveLength(8);
    expect(recommendForUseCase(many, { task: "bulk", costSensitivity: "high" }, 3)).toHaveLength(3);
  });
});

describe("mergeCatalog and curated entries", () => {
  it("combines providers into one list", () => {
    const or: CatalogModel[] = [
      {
        ref: "openrouter/x",
        id: "x",
        name: "X",
        provider: "openrouter",
        contextLength: 1000,
        promptPerMTok: 1,
        completionPerMTok: 1,
        inputModalities: ["text"],
        outputModalities: ["text"],
        supportsSampling: true,
        supportsTools: true,
      },
    ];
    const merged = mergeCatalog(or, CURATED_MODELS);
    const providers = new Set(merged.map((m) => m.provider));
    expect(providers).toEqual(new Set(["openrouter", "anthropic", "workers-ai"]));
    expect(merged.length).toBe(or.length + CURATED_MODELS.length);
  });

  it("sets curated sampling support per the model contract", () => {
    const haiku = ANTHROPIC_MODELS.find((m) => m.id === "claude-haiku-4-5");
    const opus = ANTHROPIC_MODELS.find((m) => m.id === "claude-opus-4-8");
    expect(haiku?.supportsSampling).toBe(true);
    expect(opus?.supportsSampling).toBe(false);
    expect(WORKERS_AI_MODELS.every((m) => m.supportsSampling)).toBe(true);
  });
});
