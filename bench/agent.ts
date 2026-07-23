/**
 * The benchmark agent: a minimal, honest ReAct-style loop with filesystem
 * tools, driven by Claude Sonnet 5 (served via OpenRouter). Both benchmark arms
 * use this exact loop — the only difference is whether a pre-computed graph
 * context bundle is injected up front (graph arm) or not (cold arm). Keeping the
 * loop identical is what makes the token/latency/correctness comparison fair.
 *
 * We run a *manual* loop so we can read `usage` off every turn and sum it, so
 * the reported token cost is exact rather than estimated.
 */
import { readFileSync, statSync, readdirSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute, sep } from "node:path";
import { SKIP_DIRS, MAX_FILE_BYTES } from "../src/ingest/fs.js";
import { ask, formatAsk, skeleton, formatSkeleton } from "../src/ask/ask.js";
import { makeChatModel, AGENT_MODEL } from "./llm.js";
import type { ChatModel, Message, ToolSpec } from "../src/ai/llm/types.js";

export { AGENT_MODEL };

export interface AgentResult {
  answer: string;
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number; total: number };
  toolCalls: number;
  iterations: number;
  wallMs: number;
  stopReason: string | null;
  toolLog: Array<{ name: string; input: unknown }>;
}

export interface RunAgentOptions {
  /** Directory the filesystem tools are confined to. */
  root: string;
  question: string;
  /** When set (graph/push arm), this bundle is injected before the question. */
  contextBundle?: string;
  /** When set (pull arm), the agent additionally gets graft_ask/graft_skeleton
   * tools over the prebuilt graph at this contextDir — nothing injected up
   * front; the agent pays for graph context only when it asks for it. */
  graft?: { contextDir: string };
  maxIterations?: number;
  model?: ChatModel;
}

const SYSTEM_PROMPT =
  "You are a software engineer answering a factual question about a codebase or a folder of documents. " +
  "The files live under the tool root. Use read_file, grep, glob, and list_dir to find the answer, then " +
  "state it directly. Investigate enough to be correct, but stop exploring once you can answer. " +
  "When you are ready, give your final answer as plain text with no further tool calls.";

/** Resolve a model-supplied path and confine it to `root` (rejects `..`, absolute escapes, symlink escapes). */
export function safePath(root: string, p: string): string {
  const abs = resolve(root, p);
  let rel = relative(root, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${p}`);
  try {
    const real = realpathSync(abs);
    const realRoot = realpathSync(root);
    rel = relative(realRoot, real);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes root: ${p}`);
    return real;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("path escapes")) throw e;
    return abs;
  }
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile()) {
        try {
          if (statSync(full).size > MAX_FILE_BYTES) continue;
        } catch {
          continue;
        }
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

/** Very small glob → RegExp (supports **, *, ?), matched against root-relative POSIX paths. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

/** Tool definitions in provider-neutral form. */
const TOOLS: ToolSpec[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file under the root. Optionally limit to a line range.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the root" },
        start_line: { type: "integer", description: "1-based first line (optional)" },
        end_line: { type: "integer", description: "1-based last line (optional)" },
      },
      required: ["path"],
    },
  },
  {
    name: "grep",
    description: "Search file contents with a JavaScript regular expression. Returns matching lines as path:line: text.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression" },
        path: { type: "string", description: "Restrict to this subdirectory or file (optional)" },
        ignore_case: { type: "boolean", description: "Case-insensitive match (optional)" },
      },
      required: ["pattern"],
    },
  },
  {
    name: "glob",
    description: "List files whose root-relative path matches a glob (e.g. src/**/*.ts).",
    parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "list_dir",
    description: "List the entries of a directory under the root.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory relative to the root (default: root)" } },
      required: [],
    },
  },
];

/** Extra tools for the pull arm: the graft graph as an on-demand service. */
const GRAFT_TOOLS: ToolSpec[] = [
  {
    name: "graft_ask",
    description:
      "Query this repo's prebuilt context graph in plain words. Returns ranked symbols/concepts with exact file:line spans and the relevant source inlined — the cheapest way to locate and understand code. Prefer it over grep/read_file for orientation; use structural phrasings too ('who calls X').",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to understand, in plain words" },
        limit: { type: "integer", description: "Max results (default 5)" },
        full: { type: "boolean", description: "Inline whole definition spans instead of crux excerpts" },
      },
      required: ["query"],
    },
  },
  {
    name: "graft_skeleton",
    description:
      "Signatures-only view of one file — every definition's signature + line span, ~10× cheaper than reading the file.",
    parameters: {
      type: "object",
      properties: { file: { type: "string", description: "Repo-relative file path" } },
      required: ["file"],
    },
  },
];

const MAX_GREP_MATCHES = 100;
const MAX_GLOB_RESULTS = 200;
const MAX_READ_LINES = 400;

function runTool(root: string, name: string, input: any, graft?: { contextDir: string }): string {
  try {
    if (graft && name === "graft_ask") {
      const limit = typeof input.limit === "number" ? input.limit : 5;
      const r = ask(root, String(input.query ?? ""), {
        contextDir: graft.contextDir, limit, source: true, full: input.full === true,
      });
      return formatAsk(r);
    }
    if (graft && name === "graft_skeleton") {
      return formatSkeleton(skeleton(root, String(input.file ?? ""), { contextDir: graft.contextDir }));
    }
    if (name === "read_file") {
      const file = safePath(root, String(input.path));
      const lines = readFileSync(file, "utf8").split("\n");
      const start = input.start_line ? Math.max(1, input.start_line) : 1;
      const end = input.end_line ? Math.min(lines.length, input.end_line) : Math.min(lines.length, start - 1 + MAX_READ_LINES);
      const slice = lines.slice(start - 1, end);
      const numbered = slice.map((l: string, i: number) => `${start + i}\t${l}`).join("\n");
      const more = end < lines.length ? `\n… (${lines.length - end} more lines)` : "";
      return numbered + more || "(empty file)";
    }
    if (name === "list_dir") {
      const dir = input.path ? safePath(root, String(input.path)) : root;
      const entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
        .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
      return entries.length ? entries.join("\n") : "(empty directory)";
    }
    if (name === "glob") {
      const re = globToRegExp(String(input.pattern));
      const hits = listFiles(root)
        .map((f) => relative(root, f).split(sep).join("/"))
        .filter((rel) => re.test(rel))
        .slice(0, MAX_GLOB_RESULTS);
      return hits.length ? hits.join("\n") : "(no files matched)";
    }
    if (name === "grep") {
      const flags = input.ignore_case ? "i" : "";
      let re: RegExp;
      try {
        re = new RegExp(String(input.pattern), flags);
      } catch (e) {
        return `invalid regex: ${e instanceof Error ? e.message : String(e)}`;
      }
      const base = input.path ? safePath(root, String(input.path)) : root;
      const files = statSync(base).isDirectory() ? listFiles(base) : [base];
      const out: string[] = [];
      for (const f of files) {
        let text: string;
        try {
          text = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        const rel = relative(root, f).split(sep).join("/");
        const fl = text.split("\n");
        for (let i = 0; i < fl.length; i++) {
          if (re.test(fl[i])) {
            out.push(`${rel}:${i + 1}: ${fl[i].trim().slice(0, 200)}`);
            if (out.length >= MAX_GREP_MATCHES) return out.join("\n") + "\n… (truncated)";
          }
        }
      }
      return out.length ? out.join("\n") : "(no matches)";
    }
    return `unknown tool: ${name}`;
  } catch (e) {
    return `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const model = opts.model ?? makeChatModel(AGENT_MODEL);
  const root = resolve(opts.root);
  const maxIterations = opts.maxIterations ?? 15;

  const userText = opts.contextBundle
    ? `A knowledge graph of these files was queried for this task and returned the context below. ` +
      `Use it to answer; you may still use the tools to confirm or fill gaps.\n\n` +
      `<graph_context>\n${opts.contextBundle}\n</graph_context>\n\nQuestion: ${opts.question}`
    : `Question: ${opts.question}`;

  // Cache breakpoints (Message.cacheBreakpoint) let the adapter mark a stable
  // prefix as cacheable. The system + tools + the (possibly large) bundle are a
  // stable head, cached once; a breakpoint then slides onto the newest tool
  // result each turn so the entire prior transcript is a cache read rather than
  // re-billed at full price — which is how Claude Code actually runs, and what
  // makes the token numbers fair.
  const systemText = opts.graft
    ? SYSTEM_PROMPT +
      " This repo also has a prebuilt context graph: the graft_ask and graft_skeleton tools query it and are much cheaper than grep/read_file for finding and understanding code."
    : SYSTEM_PROMPT;
  const tools = opts.graft ? [...TOOLS, ...GRAFT_TOOLS] : TOOLS;
  const messages: Message[] = [
    { role: "system", content: systemText, cacheBreakpoint: true },
    { role: "user", content: userText, cacheBreakpoint: true },
  ];

  /** Keep the cache breakpoint on the most recent tool result (strip it from older ones). */
  const slideCacheBreakpoint = () => {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    toolMsgs.forEach((m, i) => {
      m.cacheBreakpoint = i === toolMsgs.length - 1;
    });
  };
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, total: 0 };
  const toolLog: AgentResult["toolLog"] = [];
  let toolCalls = 0;
  let iterations = 0;
  let stopReason: string | null = null;
  let answer = "";

  const started = Date.now();
  for (iterations = 1; iterations <= maxIterations; iterations++) {
    const resp = await model.create({ messages, tools, maxTokens: 4096 });
    // Usage is already normalized (input = uncached-only) by the adapter.
    tokens.input += resp.usage.input;
    tokens.output += resp.usage.output;
    tokens.cacheRead += resp.usage.cacheRead;
    tokens.cacheCreate += resp.usage.cacheCreate;
    stopReason = resp.stopReason;

    messages.push(resp.assistant); // preserve the assistant turn (verbatim replay) for the next request

    if (resp.toolCalls.length === 0) {
      answer = resp.text.trim();
      break;
    }

    for (const tc of resp.toolCalls) {
      toolCalls++;
      const input = (tc.args ?? {}) as any; // already parsed by the adapter
      toolLog.push({ name: tc.name, input });
      const result = runTool(root, tc.name, input, opts.graft);
      messages.push({ role: "tool", toolCallId: tc.id, content: result });
    }
    slideCacheBreakpoint();
  }

  if (!answer) {
    // Loop hit the cap — take the last assistant text we have.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].content.trim()) {
        answer = messages[i].content.trim();
        break;
      }
    }
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheRead;
  return { answer, tokens, toolCalls, iterations, wallMs: Date.now() - started, stopReason, toolLog };
}
