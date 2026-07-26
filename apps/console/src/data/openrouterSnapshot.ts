/**
 * A frozen SAMPLE snapshot of the OpenRouter models list.
 *
 * The live console fetches this list from the gateway, which fetches it live
 * from OpenRouter. Offline, the mock gateway serves this snapshot instead so the
 * built static site behaves the same with no backend. These are placeholder
 * sample records shaped exactly like the real OpenRouter API `data[]`, not a
 * live measurement. They are covered by the console's sample data notice. Prices
 * are USD per token, as the real API reports them.
 */
import type { OpenRouterModel } from "@conduit/catalog";

export const OPENROUTER_SNAPSHOT: OpenRouterModel[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Meta: Llama 3.3 70B Instruct",
    pricing: { prompt: "0.00000059", completion: "0.00000079" },
    context_length: 131072,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct",
    name: "Meta: Llama 3.1 8B Instruct",
    pricing: { prompt: "0.00000002", completion: "0.00000005" },
    context_length: 131072,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek V3",
    pricing: { prompt: "0.00000028", completion: "0.00000088" },
    context_length: 163840,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek R1",
    pricing: { prompt: "0.00000055", completion: "0.00000219" },
    context_length: 163840,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    // Reasoning tier: no sampling params.
    supported_parameters: ["response_format", "tools"],
  },
  {
    id: "qwen/qwen-2.5-72b-instruct",
    name: "Qwen2.5 72B Instruct",
    pricing: { prompt: "0.00000038", completion: "0.0000004" },
    context_length: 131072,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "qwen/qwen-2.5-coder-32b-instruct",
    name: "Qwen2.5 Coder 32B Instruct",
    pricing: { prompt: "0.00000018", completion: "0.00000018" },
    context_length: 32768,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "mistralai/mistral-large",
    name: "Mistral Large",
    pricing: { prompt: "0.000002", completion: "0.000006" },
    context_length: 128000,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "mistralai/mistral-nemo",
    name: "Mistral Nemo",
    pricing: { prompt: "0.00000003", completion: "0.00000007" },
    context_length: 131072,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "google/gemini-flash-1.5",
    name: "Google: Gemini Flash 1.5",
    pricing: { prompt: "0.000000075", completion: "0.0000003" },
    context_length: 1000000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "google/gemini-pro-1.5",
    name: "Google: Gemini Pro 1.5",
    pricing: { prompt: "0.00000125", completion: "0.000005" },
    context_length: 2000000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "openai/gpt-4o",
    name: "OpenAI: GPT-4o",
    pricing: { prompt: "0.0000025", completion: "0.00001" },
    context_length: 128000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "openai/gpt-4o-mini",
    name: "OpenAI: GPT-4o mini",
    pricing: { prompt: "0.00000015", completion: "0.0000006" },
    context_length: 128000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools", "response_format"],
  },
  {
    id: "anthropic/claude-3.5-sonnet",
    name: "Anthropic: Claude 3.5 Sonnet",
    pricing: { prompt: "0.000003", completion: "0.000015" },
    context_length: 200000,
    architecture: { modality: "text+image->text", input_modalities: ["text", "image"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "microsoft/wizardlm-2-8x22b",
    name: "WizardLM-2 8x22B",
    pricing: { prompt: "0.0000005", completion: "0.0000005" },
    context_length: 65536,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p"],
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-70b",
    name: "Nous: Hermes 3 70B",
    pricing: { prompt: "0.0000003", completion: "0.0000003" },
    context_length: 131072,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
  {
    id: "cohere/command-r-plus",
    name: "Cohere: Command R+",
    pricing: { prompt: "0.0000025", completion: "0.00001" },
    context_length: 128000,
    architecture: { modality: "text->text", input_modalities: ["text"], output_modalities: ["text"] },
    supported_parameters: ["temperature", "top_p", "tools"],
  },
];
