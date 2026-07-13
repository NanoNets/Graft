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
import type OpenAI from "openai";
import { readFileSync, statSync, readdirSync, realpathSync } from "node:fs";
import { resolve, relative, join, isAbsolute, sep } from "node:path";
import { SKIP_DIRS, MAX_FILE_BYTES } from "../src/ingest/fs.js";
import { makeClient, AGENT_MODEL } from "./llm.js";

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
  /** When set (graph arm), this bundle is injected before the question. */
  contextBundle?: string;
  maxIterations?: number;
  client?: OpenAI;
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

/** Tool definitions in OpenAI/OpenRouter function-calling format. */
const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
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
  },
  {
    type: "function",
    function: {
      name: "glob",
      description: "List files whose root-relative path matches a glob (e.g. src/**/*.ts).",
      parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List the entries of a directory under the root.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Directory relative to the root (default: root)" } },
        required: [],
      },
    },
  },
];

const MAX_GREP_MATCHES = 100;
const MAX_GLOB_RESULTS = 200;
const MAX_READ_LINES = 400;

function runTool(root: string, name: string, input: any): string {
  try {
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
  const client = opts.client ?? makeClient();
  const root = resolve(opts.root);
  const maxIterations = opts.maxIterations ?? 15;

  const userText = opts.contextBundle
    ? `A knowledge graph of these files was queried for this task and returned the context below. ` +
      `Use it to answer; you may still use the tools to confirm or fill gaps.\n\n` +
      `<graph_context>\n${opts.contextBundle}\n</graph_context>\n\nQuestion: ${opts.question}`
    : `Question: ${opts.question}`;

  // Content is expressed as parts so we can attach Anthropic prompt-caching
  // breakpoints (OpenRouter forwards `cache_control` to Anthropic). The system
  // + tools + the (possibly large) bundle are a stable head, cached once; a
  // breakpoint then slides onto the newest tool result each turn so the entire
  // prior transcript is a cache read rather than re-billed at full price —
  // which is how Claude Code actually runs, and what makes the token numbers fair.
  const cc = { type: "ephemeral" as const };
  const messages: any[] = [
    { role: "system", content: [{ type: "text", text: SYSTEM_PROMPT, cache_control: cc }] },
    { role: "user", content: [{ type: "text", text: userText, cache_control: cc }] },
  ];

  /** Keep the cache breakpoint on the most recent tool result (strip it from older ones). */
  const slideCacheBreakpoint = () => {
    const toolMsgs = messages.filter((m) => m.role === "tool");
    toolMsgs.forEach((m, i) => {
      const part = Array.isArray(m.content) ? m.content[m.content.length - 1] : null;
      if (part) part.cache_control = i === toolMsgs.length - 1 ? cc : undefined;
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
    const resp = await client.chat.completions.create({
      model: AGENT_MODEL,
      max_tokens: 4096,
      messages,
      tools: TOOLS,
    });
    const u: any = resp.usage ?? {};
    const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
    tokens.cacheRead += cached;
    tokens.input += Math.max(0, (u.prompt_tokens ?? 0) - cached); // uncached input only
    tokens.output += u.completion_tokens ?? 0;
    const choice = resp.choices[0];
    stopReason = choice?.finish_reason ?? null;
    const msg = choice?.message;
    if (!msg) break;

    messages.push(msg); // preserve the assistant turn (with any tool_calls) for the next request

    const toolCallList = msg.tool_calls ?? [];
    if (toolCallList.length === 0) {
      answer = (msg.content ?? "").trim();
      break;
    }

    for (const tc of toolCallList) {
      if (tc.type !== "function") continue;
      toolCalls++;
      let input: any = {};
      try {
        input = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* leave input empty; runTool will error informatively */
      }
      toolLog.push({ name: tc.function.name, input });
      const result = runTool(root, tc.function.name, input);
      messages.push({ role: "tool", tool_call_id: tc.id, content: [{ type: "text", text: result }] });
    }
    slideCacheBreakpoint();
  }

  if (!answer) {
    // Loop hit the cap — take the last assistant text we have.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && typeof messages[i].content === "string" && messages[i].content.trim()) {
        answer = messages[i].content.trim();
        break;
      }
    }
  }

  tokens.total = tokens.input + tokens.output + tokens.cacheRead;
  return { answer, tokens, toolCalls, iterations, wallMs: Date.now() - started, stopReason, toolLog };
}
