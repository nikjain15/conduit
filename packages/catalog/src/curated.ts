/**
 * Curated, non-OpenRouter entries in the same normalized `CatalogModel` shape.
 *
 * These are the managed Anthropic tiers and a couple of Cloudflare Workers-AI
 * open models. OpenRouter reports its own prices per token; these providers are
 * billed under separate managed and edge agreements, so `promptPerMTok` and
 * `completionPerMTok` are left at 0 here as a "not price listed in this catalog"
 * placeholder rather than an invented figure. Workers-AI carries a genuine
 * free-tier 0 (see @conduit/inference). Context windows are model spec facts.
 *
 * `supportsSampling` mirrors the inference core contract: the current Anthropic
 * reasoning tiers reject temperature / top_p / top_k with an HTTP 400, while
 * Haiku 4.5 and the Workers-AI open models accept them. There is no Haiku 5.
 */
import type { CatalogModel } from "./types.ts";

export const ANTHROPIC_MODELS: CatalogModel[] = [
  {
    ref: "anthropic/claude-opus-5",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    provider: "anthropic",
    contextLength: 200000,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: false,
    supportsTools: true,
  },
  {
    ref: "anthropic/claude-opus-4-8",
    id: "claude-opus-4-8",
    name: "Claude Opus 4.8",
    provider: "anthropic",
    contextLength: 200000,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: false,
    supportsTools: true,
  },
  {
    ref: "anthropic/claude-sonnet-5",
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    provider: "anthropic",
    contextLength: 200000,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: false,
    supportsTools: true,
  },
  {
    ref: "anthropic/claude-fable-5",
    id: "claude-fable-5",
    name: "Claude Fable 5",
    provider: "anthropic",
    contextLength: 200000,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: false,
    supportsTools: true,
  },
  {
    ref: "anthropic/claude-haiku-4-5",
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextLength: 200000,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: true,
    supportsTools: true,
  },
];

export const WORKERS_AI_MODELS: CatalogModel[] = [
  {
    ref: "workers-ai/@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    name: "Llama 3.3 70B Instruct (Workers-AI)",
    provider: "workers-ai",
    contextLength: 131072,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: true,
    supportsTools: true,
  },
  {
    ref: "workers-ai/@cf/qwen/qwen2.5-coder-32b-instruct",
    id: "@cf/qwen/qwen2.5-coder-32b-instruct",
    name: "Qwen2.5 Coder 32B Instruct (Workers-AI)",
    provider: "workers-ai",
    contextLength: 32768,
    promptPerMTok: 0,
    completionPerMTok: 0,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsSampling: true,
    supportsTools: false,
  },
];

/** All curated, non-OpenRouter entries in one array. */
export const CURATED_MODELS: CatalogModel[] = [...ANTHROPIC_MODELS, ...WORKERS_AI_MODELS];
