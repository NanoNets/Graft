/**
 * LLM plumbing for the benchmark. Routed through OpenRouter (the same key the
 * engine uses for extraction) via the OpenAI-compatible SDK, so no separate
 * Anthropic API key is needed. Models are still Claude — just served by
 * OpenRouter — and overridable via env.
 */
import OpenAI from "openai";

export const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
export const AGENT_MODEL = process.env.BENCH_AGENT_MODEL ?? "anthropic/claude-sonnet-5";
export const JUDGE_MODEL = process.env.BENCH_JUDGE_MODEL ?? "anthropic/claude-opus-4.8";

/** A configured OpenRouter client. Throws if the key is missing (the cold arm can't run without it either). */
export function makeClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required (agent + judge run through OpenRouter).");
  return new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
}
