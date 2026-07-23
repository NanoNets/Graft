/**
 * token-ab.ts — a manual A/B harness to see whether graft saves an agent tokens.
 *
 * Same question, same model, two arms:
 *   COLD   — the agent gets only `search` + `read_file` tools and must explore
 *            the repo itself (what a normal coding agent does).
 *   GRAFT  — the agent gets the SAME tools, but the `graft ask --source` pack is
 *            pasted into its context up front, so it can answer without exploring.
 *
 * It prints a side-by-side metrics table (tokens, LLM round-trips, tool calls,
 * files opened, wall-clock) and BOTH final answers, so you judge equivalence.
 *
 * Prereqs:
 *   1. OPENROUTER_API_KEY in context-engine/.env (already there).
 *   2. graft built in the target repo:  cd <REPO> && graft build
 *
 * Run:   npx tsx bench/token-ab.ts
 * Tune:  edit the CONFIG block, or override via env (REPO, QUESTION, MODEL, MAX_STEPS).
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { makeChatModel } from "./llm.js";
import type { Message, ToolSpec } from "../src/ai/llm/types.js";

// ─────────────────────────── CONFIG (edit freely) ───────────────────────────
const CONFIG = {
  REPO: process.env.REPO ?? "/Users/anirudh/Documents/assign/frontend",
  QUESTION:
    process.env.QUESTION ??
    "When a user sends a message to an agent in the chat UI, trace the full path end to end: " +
      "which component handles the submit, how the message reaches the backend API, how the optimistic " +
      "update and the polling query stay in sync via the React Query cache key, where the agent is " +
      "resolved from the route, and where a quota/402 billing error is handled. " +
      "List the specific files and functions in order.",
  MODEL: process.env.MODEL ?? "openai/gpt-4o-mini",
  MAX_STEPS: Number(process.env.MAX_STEPS ?? 14), // cap on agent tool-loop round-trips
  SEARCH_MAX_LINES: 60, // cap rows returned per search
  READ_MAX_LINES: 400, // cap lines returned per read_file
  READ_MAX_CHARS: 12_000, // hard char cap per read_file
  // Optional cost estimate: set $ per 1M tokens for your model to see a $ column.
  PRICE_IN_PER_M: Number(process.env.PRICE_IN_PER_M ?? 0),
  PRICE_OUT_PER_M: Number(process.env.PRICE_OUT_PER_M ?? 0),
};
// ─────────────────────────────────────────────────────────────────────────────

if (!existsSync(CONFIG.REPO)) {
  console.error(`✗ REPO not found: ${CONFIG.REPO}`);
  process.exit(1);
}

const model = makeChatModel(CONFIG.MODEL);

interface Metrics {
  arm: string;
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  toolCalls: number;
  filesRead: Set<string>;
  ms: number;
  answer: string;
}

const SYSTEM =
  "You are a senior engineer answering a question about an unfamiliar codebase. " +
  "Be accurate and cite specific files and functions. When you have enough to answer, " +
  "STOP calling tools and write the final answer as prose. Do not pad.";

const TOOLS: ToolSpec[] = [
  {
    name: "search",
    description:
      "Regex search across the repo's source (ripgrep). Returns matching file:line: text rows.",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string", description: "regex or literal to search for" } },
      required: ["pattern"],
    },
  },
  {
    name: "read_file",
    description: "Read a source file (optionally a line range) relative to the repo root.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "repo-relative path, e.g. src/components/chat/TaskFeed.tsx" },
        start_line: { type: "number", description: "1-based start line (optional)" },
        end_line: { type: "number", description: "1-based end line (optional)" },
      },
      required: ["path"],
    },
  },
];

// ── tool implementations (sandboxed to REPO) ────────────────────────────────
function runSearch(pattern: string): string {
  const args = [
    "--no-heading", "-n", "-S", "--max-count", "40",
    "-g", "*.ts", "-g", "*.tsx", "-g", "!node_modules",
    pattern, CONFIG.REPO,
  ];
  let out = "";
  try {
    out = execFileSync("rg", args, { encoding: "utf8", maxBuffer: 8 << 20 });
  } catch (e: any) {
    // rg exits 1 on "no matches"; also handle rg-not-installed by falling back to grep.
    if (e?.code === "ENOENT") {
      try {
        out = execFileSync(
          "grep",
          ["-rniE", "--include=*.ts", "--include=*.tsx", "--exclude-dir=node_modules", pattern, CONFIG.REPO],
          { encoding: "utf8", maxBuffer: 8 << 20 },
        );
      } catch (g: any) {
        out = g?.stdout?.toString() ?? "";
      }
    } else {
      out = e?.stdout?.toString() ?? "";
    }
  }
  const lines = out.split("\n").filter(Boolean).map((l) => l.replace(CONFIG.REPO + "/", ""));
  if (lines.length === 0) return "(no matches)";
  const clipped = lines.slice(0, CONFIG.SEARCH_MAX_LINES);
  const note = lines.length > clipped.length ? `\n… ${lines.length - clipped.length} more rows omitted` : "";
  return clipped.join("\n") + note;
}

function runRead(path: string, start?: number, end?: number): { text: string; resolved: string } {
  const abs = isAbsolute(path) ? resolve(path) : resolve(CONFIG.REPO, path);
  const rel = relative(CONFIG.REPO, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return { text: `(refused: ${path} is outside the repo)`, resolved: rel };
  if (!existsSync(abs)) return { text: `(not found: ${rel})`, resolved: rel };
  let content = readFileSync(abs, "utf8");
  const allLines = content.split("\n");
  let lines = allLines;
  if (start || end) {
    const s = Math.max(1, start ?? 1);
    const e = Math.min(allLines.length, end ?? allLines.length);
    lines = allLines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`);
  }
  if (lines.length > CONFIG.READ_MAX_LINES) lines = lines.slice(0, CONFIG.READ_MAX_LINES);
  let text = lines.join("\n");
  if (text.length > CONFIG.READ_MAX_CHARS) text = text.slice(0, CONFIG.READ_MAX_CHARS) + "\n… (truncated)";
  return { text, resolved: rel };
}

// ── the agent loop, shared by both arms ──────────────────────────────────────
async function runAgent(arm: string, extraContext: string | null): Promise<Metrics> {
  const m: Metrics = {
    arm, llmCalls: 0, promptTokens: 0, completionTokens: 0, toolCalls: 0,
    filesRead: new Set(), ms: 0, answer: "",
  };
  const t0 = Date.now();

  const userParts = [`QUESTION:\n${CONFIG.QUESTION}`];
  if (extraContext) {
    userParts.push(
      "\nYou have been given a pre-computed context pack from a code-graph tool below. " +
        "Prefer it; only use the search/read_file tools if it is genuinely insufficient.\n\n" +
        "=== CONTEXT PACK ===\n" + extraContext,
    );
  }
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userParts.join("\n") },
  ];

  for (let step = 0; step < CONFIG.MAX_STEPS; step++) {
    const resp = await model.create({ temperature: 0, maxTokens: 4096, messages, tools: TOOLS });
    m.llmCalls++;
    m.promptTokens += resp.usage.input + resp.usage.cacheRead;
    m.completionTokens += resp.usage.output;

    messages.push(resp.assistant);

    if (resp.toolCalls.length === 0) {
      m.answer = resp.text || "(empty)";
      break;
    }

    for (const call of resp.toolCalls) {
      m.toolCalls++;
      let result = "";
      try {
        const args = (call.args ?? {}) as any;
        if (call.name === "search") {
          result = runSearch(String(args.pattern ?? ""));
        } else if (call.name === "read_file") {
          const r = runRead(String(args.path ?? ""), args.start_line, args.end_line);
          if (existsSync(resolve(CONFIG.REPO, String(args.path ?? "")))) m.filesRead.add(r.resolved);
          result = r.text;
        } else {
          result = `(unknown tool ${call.name})`;
        }
      } catch (e: any) {
        result = `(tool error: ${e?.message ?? e})`;
      }
      messages.push({ role: "tool", toolCallId: call.id, content: result });
    }
    if (step === CONFIG.MAX_STEPS - 1) m.answer = "(hit MAX_STEPS without a final answer)";
  }

  m.ms = Date.now() - t0;
  return m;
}

// ── graft pack for the GRAFT arm ─────────────────────────────────────────────
function graftPack(): { pack: string; ms: number } {
  const t0 = Date.now();
  if (!existsSync(resolve(CONFIG.REPO, "graft"))) {
    console.error(`✗ no graft/ index in ${CONFIG.REPO}. Run:  cd ${CONFIG.REPO} && graft build`);
    process.exit(1);
  }
  const pack = execFileSync("graft", ["ask", CONFIG.QUESTION, CONFIG.REPO, "--source"], {
    encoding: "utf8",
    maxBuffer: 16 << 20,
  });
  return { pack, ms: Date.now() - t0 };
}

function cost(m: Metrics): string {
  if (!CONFIG.PRICE_IN_PER_M && !CONFIG.PRICE_OUT_PER_M) return "—";
  const c = (m.promptTokens / 1e6) * CONFIG.PRICE_IN_PER_M + (m.completionTokens / 1e6) * CONFIG.PRICE_OUT_PER_M;
  return "$" + c.toFixed(4);
}

function row(label: string, a: string | number, b: string | number): string {
  return `${label.padEnd(22)} ${String(a).padStart(14)} ${String(b).padStart(14)}`;
}

async function main() {
  console.log(`\nREPO:     ${CONFIG.REPO}`);
  console.log(`MODEL:    ${CONFIG.MODEL}`);
  console.log(`QUESTION: ${CONFIG.QUESTION.slice(0, 100)}…\n`);

  console.log("→ generating graft pack (graft ask --source)…");
  const { pack, ms: graftMs } = graftPack();
  const packTokEst = Math.round(pack.length / 4); // rough: ~4 chars/token
  console.log(`  pack: ${pack.length} chars (~${packTokEst} tok), produced in ${graftMs}ms ($0, local)\n`);

  console.log("→ running COLD arm (agent explores the repo itself)…");
  const cold = await runAgent("COLD", null);
  console.log(`  done in ${cold.ms}ms, ${cold.llmCalls} LLM calls\n`);

  console.log("→ running GRAFT arm (agent handed the pack up front)…");
  const graft = await runAgent("GRAFT", pack);
  console.log(`  done in ${graft.ms}ms, ${graft.llmCalls} LLM calls\n`);

  const totC = cold.promptTokens + cold.completionTokens;
  const totG = graft.promptTokens + graft.completionTokens;
  const pct = (a: number, b: number) => (a === 0 ? "—" : `${Math.round((1 - b / a) * 100)}%`);

  console.log("═".repeat(54));
  console.log(row("metric", "COLD", "GRAFT"));
  console.log("─".repeat(54));
  console.log(row("prompt tokens", cold.promptTokens, graft.promptTokens));
  console.log(row("completion tokens", cold.completionTokens, graft.completionTokens));
  console.log(row("TOTAL tokens", totC, totG));
  console.log(row("LLM round-trips", cold.llmCalls, graft.llmCalls));
  console.log(row("tool calls", cold.toolCalls, graft.toolCalls));
  console.log(row("files opened", cold.filesRead.size, graft.filesRead.size));
  console.log(row("wall-clock (ms)", cold.ms, graft.ms));
  console.log(row("est. cost", cost(cold), cost(graft)));
  console.log("─".repeat(54));
  console.log(`token saving with graft: ${pct(totC, totG)}  (COLD→GRAFT)`);
  console.log("═".repeat(54));

  console.log("\n──────── COLD answer ────────\n" + cold.answer);
  console.log("\n──────── GRAFT answer ────────\n" + graft.answer);
  console.log("\n(Judge the two answers yourself — the point is equal quality at fewer tokens.)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
