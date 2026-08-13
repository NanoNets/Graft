import type { Summarizer } from "./summarize.js";
import type { Synthesizer } from "./synthesize.js";
import type { CruxSummarizer } from "./crux.js";
import type { ChatModel } from "./llm/types.js";
import { PROVIDER_KINDS, providerNeedsKey, type ProviderKind } from "./llm/factory.js";
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
  /** Per-call timeout in ms, all providers. Env: GRAFT_TIMEOUT_MS (or GRAFT_CLAUDE_TIMEOUT_MS). */
  timeoutMs?: number;
  /** `claude-cli` only: per-call spend ceiling. Env: GRAFT_CLAUDE_MAX_BUDGET_USD. */
  maxBudgetUsd?: number;
  /** Retries after a failed call, all providers. Env: GRAFT_MAX_RETRIES. Default 2.
   * `0` is legal and means "fail on the first error". */
  maxRetries?: number;

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
  maxRetries?: number;
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

/**
 * Per-provider default model, named the way that provider's OWN endpoint names
 * it. `openai` therefore defaults to the bare `gpt-4o-mini`: with no `baseUrl`
 * the SDK talks to api.openai.com, and the `vendor/slug` form this used to carry
 * is OpenRouter's addressing scheme — api.openai.com answers it with a 404
 * `model_not_found`. That made the most obvious setup of all (an OpenAI key in
 * GRAFT_API_KEY and nothing else) fail on every single call of a `--deep` run.
 */
export const DEFAULT_MODELS: Record<ProviderKind, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-5",
  // An alias, not a pinned id: the CLI maps it to the current Sonnet, so a graft
  // release never has to ship a new version to follow a model refresh.
  "claude-cli": "sonnet",
};

/** Same model, in OpenRouter's `vendor/slug` addressing. */
const OPENROUTER_DEFAULT_MODEL = "openai/gpt-4o-mini";

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
  const named = validProvider(config.provider ?? env.GRAFT_PROVIDER);
  const autoDetectedProvider = !named && !apiKey && claudeCliAvailable(config.bin ?? env.GRAFT_CLAUDE_BIN);
  const provider = named ?? (autoDetectedProvider ? "claude-cli" : DEFAULTS.provider);

  let baseUrl = config.baseUrl ?? env.GRAFT_BASE_URL ?? env.OPENROUTER_BASE_URL;
  // Back-compat: an existing setup with only OPENROUTER_API_KEY keeps hitting
  // OpenRouter without any config change.
  if (!baseUrl && provider === "openai" && usedLegacyEnv) baseUrl = OPENROUTER_BASE_URL;

  const isOpenRouter = provider === "openai" && !!baseUrl?.includes("openrouter.ai");
  // The default model has to follow the endpoint, because the two spell the same
  // model differently — see DEFAULT_MODELS. Resolved AFTER baseUrl for that
  // reason; an explicit GRAFT_MODEL is never second-guessed.
  const model =
    config.model ??
    env.GRAFT_MODEL ??
    env.GRAFT_OPENROUTER_MODEL ??
    (isOpenRouter ? OPENROUTER_DEFAULT_MODEL : DEFAULT_MODELS[provider]);

  const headers = isOpenRouter ? { "X-Title": "graft" } : undefined;

  // GRAFT_CLAUDE_TIMEOUT_MS predates the provider-neutral name and stays the more
  // specific override, so a setup that already tuned it keeps its value.
  const timeoutMs = config.timeoutMs ?? numeric(env.GRAFT_CLAUDE_TIMEOUT_MS) ?? numeric(env.GRAFT_TIMEOUT_MS);
  const maxBudgetUsd = config.maxBudgetUsd ?? numeric(env.GRAFT_CLAUDE_MAX_BUDGET_USD);
  // Its own parser: `numeric` rejects 0 (right for a budget or a timeout, where 0
  // means "unset"), but 0 retries is a deliberate, useful setting — fail on the
  // first error instead of sleeping three times per file against an endpoint that
  // is never going to answer.
  const maxRetries = config.maxRetries ?? nonNegativeInt(env.GRAFT_MAX_RETRIES);

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
    maxRetries,
    autoDetectedProvider,
    usedLegacyEnv,
    chatModel: config.chatModel,
    synthesizer: config.synthesizer,
    summarizer: config.summarizer,
    cruxSummarizer: config.cruxSummarizer,
  };
}

/**
 * Reject an unknown provider HERE, where the user's typo is still in hand.
 *
 * A bare cast let `GRAFT_PROVIDER=gemini` through the whole resolution: the model
 * silently became `undefined` (despite `ResolvedConfig.model: string`), the
 * manifest recorded `gemini:undefined`, and the only complaint arrived from the
 * factory's exhaustiveness guard — which names neither the env var nor the legal
 * values. The message doubles as the fix, because "gemini" is usually not a typo
 * but a misreading of what `provider` selects.
 */
function validProvider(v: string | undefined): ProviderKind | undefined {
  // `GRAFT_PROVIDER=` in a .env file arrives as "" — that is "unset", not a typo,
  // and it must keep falling through to the auto-detection below it.
  if (!v) return undefined;
  if ((PROVIDER_KINDS as readonly string[]).includes(v)) return v as ProviderKind;
  throw new Error(
    `GRAFT_PROVIDER="${v}" is not one of ${PROVIDER_KINDS.join(", ")}.\n` +
      "  `provider` names the WIRE FORMAT, not a vendor — for Gemini, Groq, Fireworks, DeepSeek,\n" +
      "  a LiteLLM proxy or a local server, keep GRAFT_PROVIDER=openai and point GRAFT_BASE_URL at\n" +
      "  their OpenAI-compatible endpoint (plus GRAFT_MODEL for that endpoint's model id).",
  );
}

function numeric(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** `numeric`, but 0 counts — see the `maxRetries` comment in resolveConfig. Note
 * `!v` still discards `""` (an unset var in a .env file), which is what we want;
 * `"0"` is truthy as a string and reaches the parse. */
function nonNegativeInt(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
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
