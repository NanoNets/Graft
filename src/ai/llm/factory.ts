/**
 * One place that turns resolved config into a {@link ChatModel}. `provider` names
 * the WIRE FORMAT, not a vendor: `openai` speaks the OpenAI-compatible API (point
 * `baseUrl` at OpenRouter, Fireworks, a LiteLLM proxy, Groq, a local server, …),
 * `anthropic` speaks the native Messages API. Adding a vendor is a base URL, not
 * a code change; adding a wire format is one new adapter here.
 */
import type { ChatModel } from "./types.js";
import { OpenAIChatModel } from "./openai.js";
import { AnthropicChatModel } from "./anthropic.js";

export type ProviderKind = "openai" | "anthropic";

export interface ChatModelConfig {
  provider: ProviderKind;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** Extra default headers for OpenAI-compatible endpoints (e.g. OpenRouter `X-Title`). */
  headers?: Record<string, string>;
}

export function createChatModel(cfg: ChatModelConfig): ChatModel {
  switch (cfg.provider) {
    case "anthropic":
      return new AnthropicChatModel({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
    case "openai":
      return new OpenAIChatModel({
        apiKey: cfg.apiKey,
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
