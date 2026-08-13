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
  /** Extra default headers, for whichever gateway sits behind `baseUrl` (e.g. OpenRouter `X-Title`). */
  headers?: Record<string, string>;
  /** `claude-cli` only: explicit path to the binary (else resolved from PATH). */
  bin?: string;
  /** Per-call wall clock in milliseconds, for every provider. */
  timeoutMs?: number;
  /** `claude-cli` only: per-call spend ceiling, passed through as `--max-budget-usd`. */
  maxBudgetUsd?: number;
  /**
   * Retries after a failed call, for every provider (default 2 — the SDKs' own).
   *
   * Worth exposing because the right number is a property of the ENDPOINT, not of
   * graft: a `--deep` build is one call per file over hours, so on a hard-rate-limited
   * key 2 retries throws away files that a longer backoff would have summarized, while
   * against a local server (llama.cpp, Ollama) retrying a refused connection 2× per
   * file just triples the time it takes to find out nothing is listening. `0` is a
   * legal value and means "fail on the first error".
   *
   * Both SDK adapters honour the endpoint's `Retry-After` header inside these
   * attempts; `claude-cli` has no headers to read (it is a subprocess) and uses its
   * own fixed backoff.
   */
  maxRetries?: number;
}

export function createChatModel(cfg: ChatModelConfig): ChatModel {
  switch (cfg.provider) {
    case "claude-cli":
      return new ClaudeCliChatModel({
        model: cfg.model,
        bin: cfg.bin,
        timeoutMs: cfg.timeoutMs,
        maxBudgetUsd: cfg.maxBudgetUsd,
        maxRetries: cfg.maxRetries,
      });
    case "anthropic":
      // headers reach this adapter too: `baseUrl` may point at a gateway that
      // speaks the Messages API and demands its own header, and dropping the
      // caller's headers there failed silently (a 401 from the gateway, with
      // nothing in the config to suggest graft had thrown them away).
      return new AnthropicChatModel({
        apiKey: requireKey(cfg),
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        headers: cfg.headers,
        timeoutMs: cfg.timeoutMs,
        maxRetries: cfg.maxRetries,
      });
    case "openai":
      return new OpenAIChatModel({
        apiKey: requireKey(cfg),
        model: cfg.model,
        baseUrl: cfg.baseUrl,
        headers: cfg.headers,
        timeoutMs: cfg.timeoutMs,
        maxRetries: cfg.maxRetries,
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
