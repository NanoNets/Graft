/**
 * Correctness scoring. Two layers, deliberately:
 *
 *  1. A deterministic required-keyword floor — the answer must contain every
 *     `requiredKeywords` substring (case-insensitive). Cheap, can't be gamed by
 *     a confident-but-wrong answer, and catches an over-generous LLM judge.
 *  2. An LLM judge (Claude Opus 4.8, via OpenRouter — deliberately stronger than
 *     the Sonnet 5 agent, so it isn't grading itself) that scores the answer
 *     against a reference and returns JSON.
 *
 * Final correctness = judge says correct AND the keyword floor passed.
 */
import type OpenAI from "openai";
import { makeClient, JUDGE_MODEL } from "./llm.js";

export { JUDGE_MODEL };

export interface Verdict {
  score: number; // 0..1 from the judge
  judgeCorrect: boolean;
  keywordPass: boolean; // deterministic floor
  correct: boolean; // judgeCorrect && keywordPass
  reasoning: string;
}

export interface JudgeInput {
  question: string;
  referenceAnswer: string;
  agentAnswer: string;
  requiredKeywords: string[];
  client?: OpenAI;
}

/** Pull the first {...} JSON object out of a string (models sometimes wrap JSON in prose/fences). */
function extractJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    return null;
  }
}

export async function judge(input: JudgeInput): Promise<Verdict> {
  const client = input.client ?? makeClient();

  const kw = input.requiredKeywords ?? [];
  const hay = input.agentAnswer.toLowerCase();
  const keywordPass = kw.every((k) => hay.includes(k.toLowerCase()));

  const prompt =
    `You are grading an AI agent's answer to a factual question about a codebase/document set. ` +
    `Respond with ONLY a JSON object of the form {"correct": boolean, "score": number, "reasoning": string} ` +
    `where score is 0.0 (wrong/irrelevant) to 1.0 (fully correct and complete). No prose, no code fences.\n\n` +
    `Question:\n${input.question}\n\n` +
    `Reference answer (ground truth):\n${input.referenceAnswer}\n\n` +
    `Agent's answer:\n${input.agentAnswer}\n\n` +
    `Grade whether the agent's answer is factually correct and responsive, judged against the reference. ` +
    `Extra correct detail is fine; contradicting the reference or missing the core fact is not.`;

  const resp = await client.chat.completions.create({
    model: JUDGE_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const text = resp.choices[0]?.message?.content ?? "";
  const parsed = extractJson(text) ?? { correct: false, score: 0, reasoning: `unparseable judge output: ${text.slice(0, 200)}` };

  const score = Math.max(0, Math.min(1, Number(parsed.score) || 0));
  const judgeCorrect = Boolean(parsed.correct);
  return {
    score,
    judgeCorrect,
    keywordPass,
    correct: judgeCorrect && keywordPass,
    reasoning: String(parsed.reasoning ?? ""),
  };
}
