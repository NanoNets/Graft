/**
 * One place that turns resolved config into a {@link ChatModel}. `provider` names
 * the WIRE FORMAT, not a vendor: `openai` speaks the OpenAI-compatible API (point
 * `baseUrl` at OpenRouter, Fireworks, a LiteLLM proxy, Groq, a local server, …),
 * `anthropic` speaks the native Messages API, and `claude-cli` speaks to the
 * locally installed Claude Code binary over stdio. Adding a vendor is a base URL,
 * not a code change; adding a wire format is one new adapter here.
 *
 * `claude-cli` is the one provider that takes NO api key — it borrows the CLI's
 * own signed-in session — so key handling is a per-provider question answered by
 * {@link providerNeedsKey} rather than an invariant of this factory.
 */
import type { ChatModel } from "./types.js";
import { OpenAIChatModel } from "./openai.js";
import { AnthropicChatModel } from "./anthropic.js";
import { ClaudeCliChatModel } from "./claude-cli.js";

export type ProviderKind = "openai" | "anthropic" | "claude-cli";

export const PROVIDER_KINDS: readonly ProviderKind[] = ["openai", "anthropic", "claude-cli"];

/** Whether a provider authenticates with an API key at all. */
export function providerNeedsKey(provider: ProviderKind): boolean {
  return provider !== "claude-cli";
}

export interface ChatModelConfig {
  provider: ProviderKind;
  /** Required by every provider except `claude-cli`, which uses its own session. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
  /** Extra default headers for OpenAI-compatible endpoints (e.g. OpenRouter `X-Title`). */
  headers?: Record<string, string>;
  /** `claude-cli` only: explicit path to the binary (else resolved from PATH). */
  bin?: string;
  /** `claude-cli` only: per-call wall clock in milliseconds. */
  timeoutMs?: number;
  /** `claude-cli` only: per-call spend ceiling, passed through as `--max-budget-usd`. */
  maxBudgetUsd?: number;
}

export function createChatModel(cfg: ChatModelConfig): ChatModel {
  switch (cfg.provider) {
    case "claude-cli":
      return new ClaudeCliChatModel({
        model: cfg.model,
        bin: cfg.bin,
        timeoutMs: cfg.timeoutMs,
        maxBudgetUsd: cfg.maxBudgetUsd,
      });
    case "anthropic":
      return new AnthropicChatModel({ apiKey: requireKey(cfg), model: cfg.model, baseUrl: cfg.baseUrl });
    case "openai":
      return new OpenAIChatModel({
        apiKey: requireKey(cfg),
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        headers: cfg.headers,
      });
    default: {
      const _exhaustive: never = cfg.provider;
      throw new Error(`unknown provider: ${String(_exhaustive)}`);
    }
  }
}

function requireKey(cfg: ChatModelConfig): string {
  if (!cfg.apiKey) throw new Error(`provider "${cfg.provider}" needs an API key — set GRAFT_API_KEY`);
  return cfg.apiKey;
}
