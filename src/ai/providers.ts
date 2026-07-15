import type { Summarizer } from "./summarize.js";
import type { Synthesizer } from "./synthesize.js";

/**
 * User-facing configuration. Anything omitted falls back to environment
 * variables and then to sensible defaults. The engine calls OpenRouter, so an
 * API key is required for any LLM-backed operation.
 */
export interface EngineConfig {
  /** Where the graph lives. Env: GRAFT_DIR. Default: `<repo>/.context`. */
  contextDir?: string;

  /** OpenRouter key for extraction + summarization. Env: OPENROUTER_API_KEY. */
  openrouterApiKey?: string;
  /** OpenRouter model id. Env: GRAFT_OPENROUTER_MODEL. Default: openai/gpt-4o-mini */
  openrouterModel?: string;
  /** OpenRouter API base URL. Env: OPENROUTER_BASE_URL. Default: https://openrouter.ai/api/v1 */
  openrouterBaseUrl?: string;

  // --- advanced: bring your own components ---
  /** Override the synthesizer (defaults to OpenRouter). */
  synthesizer?: Synthesizer;
  /** Override the code summarizer (defaults to OpenRouter). */
  summarizer?: Summarizer;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  contextDir?: string;
  openrouterApiKey?: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  synthesizer?: Synthesizer;
  summarizer?: Summarizer;
}

export const DEFAULTS = {
  openrouterModel: "openai/gpt-4o-mini",
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
} as const;

/** Merge user config with environment variables and defaults. */
export function resolveConfig(config: EngineConfig = {}): ResolvedConfig {
  const env = process.env;
  return {
    contextDir: config.contextDir ?? env.GRAFT_DIR,
    openrouterApiKey: config.openrouterApiKey ?? env.OPENROUTER_API_KEY,
    openrouterModel:
      config.openrouterModel ?? env.GRAFT_OPENROUTER_MODEL ?? DEFAULTS.openrouterModel,
    openrouterBaseUrl:
      config.openrouterBaseUrl ?? env.OPENROUTER_BASE_URL ?? DEFAULTS.openrouterBaseUrl,
    synthesizer: config.synthesizer,
    summarizer: config.summarizer,
  };
}
