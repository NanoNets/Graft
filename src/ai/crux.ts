/**
 * Tier-2 "meaning" call for the code graph — batched one request per file.
 *
 * Given a source file (with 1-based line numbers) and the list of definitions in
 * it, one call returns, for each definition:
 *   1. `summary` — one plain-English sentence: what the symbol is *for*, at the
 *      business-logic level, not a restatement of its signature.
 *   2. `crux_start`/`crux_end` — the smallest contiguous range of FILE line
 *      numbers (inside that symbol's own span) that a reviewer must read to see
 *      the decision or rule the code encodes. `0/0` means there is no single
 *      crux (a trivial getter, a plain data holder).
 *
 * Batching per file means N definitions cost one request, not N — and the model
 * sees each symbol's neighbours, which sharpens the summaries. Line numbers are
 * consumed once, at write time, to slice the crux text verbatim from source.
 */
import OpenAI from "openai";
import type { Kind } from "../graph/types.js";

/** One definition we want described, located by its line span within the file. */
export interface NodeRef {
  id: string;
  kind: Kind;
  signature: string | null;
  startLine: number; // 1-based file line where the definition starts
  endLine: number;
}

export interface FileCruxInput {
  path: string;
  source: string;
  nodes: NodeRef[];
}

export interface NodeCrux {
  id: string;
  summary: string;
  crux_start: number; // file line, within the symbol's span; 0 = no distinct crux
  crux_end: number;
}

export interface CruxSummarizer {
  describeFile(input: FileCruxInput): Promise<NodeCrux[]>;
}

const SYSTEM_PROMPT = `You explain code definitions for a code graph that helps engineers navigate a codebase.

You are given ONE source file with 1-based line numbers, and a list of TARGET definitions in it. For every target, return its purpose and the line range of its core logic.

Return STRICT JSON, exactly:
{ "symbols": [ { "id": string, "summary": string, "crux_start": number, "crux_end": number }, ... ] }

Rules:
- Emit exactly one entry per target id given, using that id verbatim.
- summary: ONE sentence — what the symbol is FOR at the business-logic level. Say what problem it solves or rule it enforces, not what its signature already says.
- crux_start / crux_end: FILE line numbers (as shown), inside that symbol's own line range. Pick the SINGLE most important contiguous span — the core branch, formula, guard, or state change. Keep it TIGHT: at most ~8 lines, and NEVER the whole function. If you can't narrow it below that, the symbol has no distinct crux — use 0/0.
- Skip boilerplate, logging, and plumbing. If a symbol has no meaningful crux (trivial getter, data holder, one-line delegation, or logic spread evenly with no focal point), use "crux_start": 0 and "crux_end": 0.
- Output ONLY the JSON object. No prose, no code fences.`;

/** Cap the file text sent per request so one huge file can't blow the context. */
const MAX_CODE_CHARS = 18_000;

function numberLines(source: string): string {
  const clipped =
    source.length > MAX_CODE_CHARS ? `${source.slice(0, MAX_CODE_CHARS)}\n… (truncated)` : source;
  return clipped
    .split("\n")
    .map((line, i) => `${i + 1}\t${line}`)
    .join("\n");
}

function userContent(input: FileCruxInput): string {
  const targets = input.nodes
    .map(
      (n) =>
        `- id=${n.id} | ${n.kind} | lines L${n.startLine}-L${n.endLine}` +
        (n.signature ? ` | ${n.signature}` : ""),
    )
    .join("\n");
  return `FILE: ${input.path}\n\n${numberLines(input.source)}\n\nTARGETS:\n${targets}`;
}

/** Best-effort parse of a model's JSON reply into a {@link NodeCrux} list. */
function parseResults(raw: string): NodeCrux[] {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const obj = JSON.parse(text) as { symbols?: unknown };
  if (!Array.isArray(obj.symbols)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);
  return obj.symbols
    .map((s) => s as Record<string, unknown>)
    .filter((s) => typeof s.id === "string")
    .map((s) => ({
      id: s.id as string,
      summary: typeof s.summary === "string" ? s.summary.trim() : "",
      crux_start: num(s.crux_start),
      crux_end: num(s.crux_end),
    }));
}

/** Crux summarizer backed by OpenRouter's OpenAI-compatible chat API. */
export class OpenRouterCruxSummarizer implements CruxSummarizer {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, baseUrl = "https://openrouter.ai/api/v1") {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
      defaultHeaders: { "X-Title": "Context Graph Engine" },
    });
    this.model = model;
  }

  async describeFile(input: FileCruxInput): Promise<NodeCrux[]> {
    if (input.nodes.length === 0) return [];
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent(input) },
      ],
    });
    return parseResults(response.choices[0]?.message?.content ?? "");
  }
}
