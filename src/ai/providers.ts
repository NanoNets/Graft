import type { Summarizer } from "./summarize.js";
import type { Synthesizer } from "./synthesize.js";
import type { CruxSummarizer } from "./crux.js";
import type { ChatModel } from "./llm/types.js";
import { providerNeedsKey, type ProviderKind } from "./llm/factory.js";
import { claudeCliAvailable } from "./llm/claude-cli.js";

/**
 * User-facing configuration. Anything omitted falls back to environment
 * variables and then to sensible defaults.
 *
 * graft is vendor-neutral: `provider` names only the WIRE FORMAT, not a company.
 * `openai` speaks the OpenAI-compatible API — point `baseUrl` at OpenRouter,
 * Fireworks, a LiteLLM proxy, Groq, a local server, or OpenAI itself, and pass
 * your own key. `anthropic` speaks the native Messages API. `claude-cli` drives a
 * locally installed, already-signed-in Claude Code binary and needs NO key — it
 * is the one provider that runs on a subscription instead of metered credits.
 */
export interface EngineConfig {
  /** Where the graph lives. Env: GRAFT_DIR. Default: `<repo>/.context`. */
  contextDir?: string;

  /** Wire format / SDK. Env: GRAFT_PROVIDER. Default: `openai`. */
  provider?: ProviderKind;
  /** API key for the chosen provider. Env: GRAFT_API_KEY (legacy: OPENROUTER_API_KEY). */
  apiKey?: string;
  /** Model id. Env: GRAFT_MODEL. Provider-specific default. */
  model?: string;
  /** Base URL for OpenAI-compatible endpoints. Env: GRAFT_BASE_URL. */
  baseUrl?: string;
  /** `claude-cli` only: path to the binary. Env: GRAFT_CLAUDE_BIN. Default: PATH lookup. */
  bin?: string;
  /** `claude-cli` only: per-call timeout in ms. Env: GRAFT_CLAUDE_TIMEOUT_MS. */
  timeoutMs?: number;
  /** `claude-cli` only: per-call spend ceiling. Env: GRAFT_CLAUDE_MAX_BUDGET_USD. */
  maxBudgetUsd?: number;

  // --- advanced: bring your own components ---
  /** Override the whole transport (skips provider/apiKey/baseUrl). */
  chatModel?: ChatModel;
  /** Override the synthesizer. */
  synthesizer?: Synthesizer;
  /** Override the code summarizer. */
  summarizer?: Summarizer;
  /** Override the per-symbol crux summarizer. */
  cruxSummarizer?: CruxSummarizer;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  contextDir?: string;
  provider: ProviderKind;
  apiKey?: string;
  model: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  bin?: string;
  timeoutMs?: number;
  maxBudgetUsd?: number;
  /** True when the key came from the deprecated OPENROUTER_* fallback. */
  usedLegacyEnv: boolean;
  /** True when no provider was named and the local Claude CLI was picked for you. */
  autoDetectedProvider: boolean;
  chatModel?: ChatModel;
  synthesizer?: Synthesizer;
  summarizer?: Summarizer;
  cruxSummarizer?: CruxSummarizer;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Per-provider default model. */
export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  openai: "openai/gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  // An alias, not a pinned id: the CLI maps it to the current Sonnet, so a graft
  // release never has to ship a new version to follow a model refresh.
  "claude-cli": "sonnet",
};

export const DEFAULTS = {
  provider: "openai" as ProviderKind,
  model: DEFAULT_MODELS.openai,
} as const;

/** Merge user config with environment variables and defaults. */
export function resolveConfig(config: EngineConfig = {}): ResolvedConfig {
  const env = process.env;

  const explicitKey = config.apiKey ?? env.GRAFT_API_KEY;
  const legacyKey = env.OPENROUTER_API_KEY;
  const apiKey = explicitKey ?? legacyKey;
  const usedLegacyEnv = !explicitKey && !!legacyKey;

  // Provider choice is explicit-first, then inferred. The inference exists so the
  // common case — a developer with a Claude subscription and no API credits —
  // gets a working `--deep` instead of an error telling them to go buy a key. It
  // only fires when NO key is configured, so an existing key-based setup keeps
  // resolving to the same provider it always did.
  const named = config.provider ?? (env.GRAFT_PROVIDER as ProviderKind | undefined);
  const autoDetectedProvider = !named && !apiKey && claudeCliAvailable(config.bin ?? env.GRAFT_CLAUDE_BIN);
  const provider = named ?? (autoDetectedProvider ? "claude-cli" : DEFAULTS.provider);

  const model =
    config.model ?? env.GRAFT_MODEL ?? env.GRAFT_OPENROUTER_MODEL ?? DEFAULT_MODELS[provider];

  let baseUrl = config.baseUrl ?? env.GRAFT_BASE_URL ?? env.OPENROUTER_BASE_URL;
  // Back-compat: an existing setup with only OPENROUTER_API_KEY keeps hitting
  // OpenRouter without any config change.
  if (!baseUrl && provider === "openai" && usedLegacyEnv) baseUrl = OPENROUTER_BASE_URL;

  const headers =
    provider === "openai" && baseUrl?.includes("openrouter.ai")
      ? { "X-Title": "graft" }
      : undefined;

  const timeoutMs = config.timeoutMs ?? numeric(env.GRAFT_CLAUDE_TIMEOUT_MS);
  const maxBudgetUsd = config.maxBudgetUsd ?? numeric(env.GRAFT_CLAUDE_MAX_BUDGET_USD);

  return {
    contextDir: config.contextDir ?? env.GRAFT_DIR,
    provider,
    apiKey,
    model,
    baseUrl,
    headers,
    bin: config.bin ?? env.GRAFT_CLAUDE_BIN,
    timeoutMs,
    maxBudgetUsd,
    autoDetectedProvider,
    usedLegacyEnv,
    chatModel: config.chatModel,
    synthesizer: config.synthesizer,
    summarizer: config.summarizer,
    cruxSummarizer: config.cruxSummarizer,
  };
}

function numeric(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Can this config actually reach a model? One answer for every caller — the CLI's
 * pre-flight warning and the engine's hard error used to each spell out "needs a
 * key", which silently became wrong the moment a keyless provider existed.
 *
 * Returns undefined when the config is usable, or the reason it is not.
 */
export function credentialProblem(cfg: ResolvedConfig): string | undefined {
  if (cfg.chatModel || (cfg.synthesizer && cfg.summarizer && cfg.cruxSummarizer)) return undefined;
  if (!providerNeedsKey(cfg.provider)) {
    if (claudeCliAvailable(cfg.bin)) return undefined;
    return (
      `GRAFT_PROVIDER=${cfg.provider} needs the Claude Code CLI, which is not on PATH.\n` +
      "  Install it from https://claude.com/claude-code and sign in with your subscription,\n" +
      "  or point GRAFT_CLAUDE_BIN at the binary."
    );
  }
  if (cfg.apiKey) return undefined;
  return (
    "No API key. Set GRAFT_API_KEY (and GRAFT_PROVIDER / GRAFT_BASE_URL / GRAFT_MODEL for your\n" +
    "  provider), or install the Claude Code CLI and run with GRAFT_PROVIDER=claude-cli to use\n" +
    "  your Claude subscription instead of a key."
  );
}
