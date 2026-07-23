/**
 * LLM plumbing for the benchmark. Routed through the same vendor-neutral
 * provider layer the engine uses (`src/ai/llm`), so the bench runs against
 * whatever provider is configured (`GRAFT_PROVIDER` / `GRAFT_API_KEY` /
 * `GRAFT_BASE_URL`, or the legacy `OPENROUTER_API_KEY`). The default models are
 * OpenRouter-style Claude ids; override per role via env.
 */
import { resolveConfig } from "../src/ai/providers.js";
import { createChatModel } from "../src/ai/llm/factory.js";
import type { ChatModel } from "../src/ai/llm/types.js";

export const AGENT_MODEL = process.env.BENCH_AGENT_MODEL ?? "anthropic/claude-sonnet-5";
export const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL ?? "anthropic/claude-opus-4.8";

/** A configured transport for `model`. Throws if no provider key is set. */
export function makeChatModel(model: string): ChatModel {
  const cfg = resolveConfig({ model });
  if (!cfg.apiKey) {
    throw new Error("Set GRAFT_API_KEY (or OPENROUTER_API_KEY) — the bench agent + judge need a provider key.");
  }
  return createChatModel({
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model,
    baseUrl: cfg.baseUrl,
    headers: cfg.headers,
  });
}
