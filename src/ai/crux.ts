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
import { isTruncated, type ChatModel } from "./llm/types.js";
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

You are given ONE source file with 1-based line numbers, and a list of TARGET definitions in it. For every target, record its purpose and the line range of its core logic via the record_symbols tool.

Rules:
- Emit exactly one entry per target id given, using that id verbatim.
- summary: ONE sentence — what the symbol is FOR at the business-logic level. Say what problem it solves or rule it enforces, not what its signature already says.
- crux_start / crux_end: FILE line numbers (as shown), inside that symbol's own line range. Pick the SINGLE most important contiguous span — the core branch, formula, guard, or state change. Keep it TIGHT: at most ~8 lines, and NEVER the whole function. If you can't narrow it below that, the symbol has no distinct crux — use 0/0.
- Skip boilerplate, logging, and plumbing. If a symbol has no meaningful crux (trivial getter, data holder, one-line delegation, or logic spread evenly with no focal point), use "crux_start": 0 and "crux_end": 0.`;

const RECORD_TOOL = "record_symbols";

const SYMBOLS_SCHEMA = {
  type: "object",
  properties: {
    symbols: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          summary: { type: "string" },
          crux_start: { type: "number" },
          crux_end: { type: "number" },
        },
        required: ["id", "summary", "crux_start", "crux_end"],
      },
    },
  },
  required: ["symbols"],
} as const;

/** Cap the file text sent per request so one huge file can't blow the context. */
const MAX_CODE_CHARS = 18_000;

/**
 * The numbered slice of the file the model will actually see, and the subset of
 * targets that lives inside it.
 *
 * The filtering is the load-bearing part. The clip is by CHARACTERS (~450 lines
 * at 18k) while the targets carry spans over the WHOLE file, so on a 1200-line
 * file the prompt used to demand a crux for `L900-L950` — lines the model was
 * never shown. It cannot refuse (the tool call is forced), so it invents a range;
 * enrich.ts then clamps that range to the node's span and slices the FULL source,
 * writing crux code that reads as grounded and is not. A symbol past the window
 * is simply not asked about, which enrich.ts records as `pending` — the honest
 * state, and the one a later run can still fix.
 */
function clipToWindow(input: FileCruxInput): { body: string; targets: NodeRef[] } {
  const whole = input.source.length <= MAX_CODE_CHARS;
  const lines = (whole ? input.source : input.source.slice(0, MAX_CODE_CHARS)).split("\n");
  // A char-wise cut lands mid-line; that fragment is not a line the model can reason about.
  if (!whole && lines.length > 1) lines.pop();
  const numbered = lines.map((line, i) => `${i + 1}\t${line}`).join("\n");
  return {
    body: whole ? numbered : `${numbered}\n… (truncated)`,
    targets: whole ? input.nodes : input.nodes.filter((n) => n.endLine <= lines.length),
  };
}

function userContent(input: FileCruxInput, body: string, targets: NodeRef[]): string {
  const list = targets
    .map(
      (n) =>
        `- id=${n.id} | ${n.kind} | lines L${n.startLine}-L${n.endLine}` +
        (n.signature ? ` | ${n.signature}` : ""),
    )
    .join("\n");
  return `FILE: ${input.path}\n\n${body}\n\nTARGETS:\n${list}`;
}

/** Normalize the tool's parsed argument object into a {@link NodeCrux} list. */
function parseResults(obj: { symbols?: unknown } | undefined): NodeCrux[] {
  if (!obj || !Array.isArray(obj.symbols)) return [];
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

/** Crux summarizer backed by any {@link ChatModel} via forced tool calling. */
export class ChatCruxSummarizer implements CruxSummarizer {
  constructor(private model: ChatModel) {}

  async describeFile(input: FileCruxInput): Promise<NodeCrux[]> {
    if (input.nodes.length === 0) return [];
    const { body, targets } = clipToWindow(input);
    // Every requested symbol sits past the truncation point. Sending the request
    // anyway costs a full call whose only possible answers are invented — and
    // enrich.ts retries a file whose targets came back missing, so it would cost
    // that twice.
    if (targets.length === 0) return [];
    const res = await this.model.create({
      temperature: 0,
      maxTokens: 8192,
      // Structured extraction over a file already in front of the model: thinking
      // would eat the same 8192 tokens the per-symbol answers have to fit in.
      thinking: { kind: "disabled" },
      tools: [
        {
          name: RECORD_TOOL,
          description: "Record each target definition's purpose and crux line range.",
          parameters: SYMBOLS_SCHEMA as unknown as Record<string, unknown>,
        },
      ],
      responseFormat: { kind: "tool", name: RECORD_TOOL },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent(input, body, targets) },
      ],
    });
    // A turn cut off before its tool_use block closed parses as zero symbols,
    // which enrich.ts cannot tell apart from "the model skipped these" — so it
    // silently marks them pending and eats the cost. Say what actually happened.
    if (isTruncated(res)) {
      throw new Error(`crux truncated at maxTokens (stop_reason=${res.stopReason}) — ${targets.length} symbols requested for ${input.path}`);
    }
    return parseResults(res.toolCalls[0]?.args as { symbols?: unknown } | undefined);
  }
}
