import type { Summarizer } from "./summarize.js";
import type { Synthesizer } from "./synthesize.js";

/**
 * User-facing configuration. Anything omitted falls back to environment
 * variables and then to sensible defaults. The engine runs fully locally
 * (Ollama) unless an OpenRouter key is present.
 */
export interface EngineConfig {
  /** Where the graph lives. Env: CONTEXT_GRAPH_DIR. Default: `<repo>/.context`. */
  contextDir?: string;

  /** OpenRouter key for extraction + summarization. Env: OPENROUTER_API_KEY. */
  openrouterApiKey?: string;
  /** OpenRouter model id. Env: CONTEXT_GRAPH_OPENROUTER_MODEL. Default: openai/gpt-4o-mini */
  openrouterModel?: string;
  /** OpenRouter API base URL. Env: OPENROUTER_BASE_URL. Default: https://openrouter.ai/api/v1 */
  openrouterBaseUrl?: string;

  /** Force local providers (Ollama) even when an OpenRouter key is set. Env: CONTEXT_GRAPH_LOCAL=1. */
  forceLocal?: boolean;
  /** Ollama model for local extraction/summarization. Env: CONTEXT_GRAPH_OLLAMA_MODEL. Default: llama3.2 */
  ollamaModel?: string;
  /** Ollama base URL. Env: CONTEXT_GRAPH_OLLAMA_URL. Default: http://localhost:11434 */
  ollamaBaseUrl?: string;

  // --- advanced: bring your own components ---
  /** Override the synthesizer (defaults to OpenRouter, or local Ollama with no key). */
  synthesizer?: Synthesizer;
  /** Override the code summarizer (same fallbacks as the synthesizer). */
  summarizer?: Summarizer;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  contextDir?: string;
  openrouterApiKey?: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  forceLocal: boolean;
  ollamaModel: string;
  ollamaBaseUrl: string;
  synthesizer?: Synthesizer;
  summarizer?: Summarizer;
}

export const DEFAULTS = {
  openrouterModel: "openai/gpt-4o-mini",
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
  ollamaModel: "llama3.2",
  ollamaBaseUrl: "http://localhost:11434",
} as const;

/** Merge user config with environment variables and defaults. */
export function resolveConfig(config: EngineConfig = {}): ResolvedConfig {
  const env = process.env;
  return {
    contextDir: config.contextDir ?? env.CONTEXT_GRAPH_DIR,
    openrouterApiKey: config.openrouterApiKey ?? env.OPENROUTER_API_KEY,
    openrouterModel:
      config.openrouterModel ?? env.CONTEXT_GRAPH_OPENROUTER_MODEL ?? DEFAULTS.openrouterModel,
    openrouterBaseUrl:
      config.openrouterBaseUrl ?? env.OPENROUTER_BASE_URL ?? DEFAULTS.openrouterBaseUrl,
    forceLocal:
      config.forceLocal ??
      ["1", "true", "yes"].includes((env.CONTEXT_GRAPH_LOCAL ?? "").toLowerCase()),
    ollamaModel: config.ollamaModel ?? env.CONTEXT_GRAPH_OLLAMA_MODEL ?? DEFAULTS.ollamaModel,
    ollamaBaseUrl: config.ollamaBaseUrl ?? env.CONTEXT_GRAPH_OLLAMA_URL ?? DEFAULTS.ollamaBaseUrl,
    synthesizer: config.synthesizer,
    summarizer: config.summarizer,
  };
}
