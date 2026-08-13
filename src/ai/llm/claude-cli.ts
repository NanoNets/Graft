/**
 * Subscription transport: drives the locally installed `claude` CLI in headless
 * mode instead of calling an HTTP API with a key.
 *
 * `--deep` was gated on GRAFT_API_KEY, so a developer already paying for a Claude
 * subscription still had to buy separate API credits to get concept nodes and
 * per-symbol summaries. Claude Code's headless mode (`claude -p`) authenticates
 * through the same OAuth session as the interactive CLI, so shelling out to it
 * turns that existing subscription into a usable transport — no key anywhere.
 *
 * The CLI is a coding AGENT, not a completions endpoint, so this adapter narrows
 * it back down to one. Every flag below is load-bearing:
 *   - `--tools ""` removes every built-in tool, so a turn is prompt → text and the
 *     model physically cannot touch the filesystem while summarizing.
 *   - `--setting-sources ""`, `--strict-mcp-config` and `--disable-slash-commands`
 *     keep the user's own hooks, MCP servers and skills out of the run.
 *   - `--system-prompt` REPLACES Claude Code's agent system prompt. That is also
 *     what keeps CLAUDE.md out: a personal "always answer in Portuguese" memory
 *     would otherwise silently rewrite every summary written into the graph.
 *   - `--no-session-persistence` stops thousands of one-shot summaries from being
 *     recorded as resumable sessions on disk.
 *
 * Two things the HTTP adapters get for free are unavailable here:
 *   - Structured output. There is no `tool_choice`, so {@link ChatRequest.responseFormat}
 *     is emulated: the schema is stated in the prompt and the reply is parsed back
 *     into a synthetic {@link ToolCall}, with one corrective retry. Callers
 *     (synthesize, crux) see the same shape they get from Anthropic or OpenAI.
 *   - `temperature` and `maxTokens`. No flag exposes either; both are dropped.
 *     graft only ever asks for temperature 0, and the drift that costs is small
 *     next to not needing a key at all.
 *
 * The prompt travels over STDIN, never argv — a 24k-char file summary would blow
 * the 32767-char Windows command-line limit — which also keeps every argument
 * short and quote-free, so the cmd.exe shim path below stays safe.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { ChatModel, ChatRequest, ChatResponse, Message, ToolCall, Usage } from "./types.js";

const PROVIDER = "claude-cli";
const JSON_TOOL = "emit_json";
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Replaces Claude Code's agent system prompt. Deliberately short and quote-free:
 * the caller's real system prompt is far too big (and too quote-heavy) to be safe
 * as an argv entry, so it rides in the stdin envelope instead.
 */
const HARNESS_SYSTEM_PROMPT =
  "You are a precise documentation and analysis engine, not a conversational assistant. " +
  "Follow the INSTRUCTIONS block exactly and answer only about the INPUT block. " +
  "Emit the requested artifact and nothing else: no preamble, no sign-off, no markdown fences.";

export interface ClaudeCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Injectable process runner — tests pass a stub so nothing is ever spawned. */
export type ClaudeCliRunner = (args: string[], stdin: string, timeoutMs: number) => Promise<ClaudeCliResult>;

export interface ClaudeCliChatModelOptions {
  /** Model alias or full id (`sonnet`, `opus`, `claude-sonnet-5`, …). */
  model: string;
  /** Path to the CLI. Default: resolved from PATH (env GRAFT_CLAUDE_BIN wins). */
  bin?: string;
  label?: string;
  /** Per-call wall clock. Default 300s — a crux pass over a big file is slow. */
  timeoutMs?: number;
  /** Optional spend ceiling passed through as `--max-budget-usd`. */
  maxBudgetUsd?: number;
  /** Retries after a transient failure (default {@link DEFAULT_MAX_RETRIES}).
   * `0` fails on the first error — the right setting when the CLI is not signed
   * in on this machine at all and every attempt will fail the same way. */
  maxRetries?: number;
  /** Inject a runner (tests stub it; production omits it). */
  run?: ClaudeCliRunner;
}

/** The `claude -p --output-format json` envelope, narrowed to what we consume. */
interface CliEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export class ClaudeCliChatModel implements ChatModel {
  readonly label: string;
  private model: string;
  private runner: ClaudeCliRunner;
  private timeoutMs: number;
  private maxBudgetUsd?: number;
  private maxRetries: number;

  constructor(opts: ClaudeCliChatModelOptions) {
    this.model = opts.model;
    this.label = opts.label ?? `${PROVIDER}:${opts.model}`;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBudgetUsd = opts.maxBudgetUsd;
    // `?? DEFAULT` and not `|| DEFAULT`: 0 is the meaningful "don't retry" value.
    this.maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.runner = opts.run ?? defaultRunner(opts.bin);
  }

  async create(req: ChatRequest): Promise<ChatResponse> {
    const fmt = req.responseFormat ?? { kind: "text" };
    const schema = schemaFor(req, fmt);
    const prompt = buildPrompt(req.messages, schema);

    let env = await this.invoke(prompt);
    let text = (env.result ?? "").trim();

    // Structured output is prompt-enforced, not wire-enforced, so a reply can come
    // back with prose around the JSON. Retry ONCE, quoting the bad reply back — far
    // cheaper than failing a 5000-file build on one malformed response.
    let parsed: unknown;
    if (fmt.kind !== "text") {
      parsed = extractJson(text);
      if (parsed === undefined) {
        env = await this.invoke(retryPrompt(prompt, text));
        text = (env.result ?? "").trim();
        parsed = extractJson(text);
      }
      if (parsed === undefined) {
        throw new Error(
          `claude CLI did not return parseable JSON for ${fmt.kind === "tool" ? fmt.name : "json"} output. ` +
            `Got: ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`,
        );
      }
    }

    const toolCalls: ToolCall[] = [];
    if (fmt.kind === "tool") {
      toolCalls.push({ id: `${PROVIDER}_1`, name: fmt.name, args: parsed });
      text = "";
    } else if (fmt.kind === "json") {
      text = JSON.stringify(parsed);
    }

    return {
      text,
      toolCalls,
      usage: normalizeUsage(env.usage),
      stopReason: env.stop_reason ?? null,
      assistant: {
        role: "assistant",
        content: text,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      },
    };
  }

  /**
   * Transport-level retry. A `--deep` build is thousands of sequential calls over
   * hours, so a single blip — an overloaded upstream, a dropped connection, one
   * slow file hitting the wall clock — would otherwise silently cost that file its
   * summary. Only failures classified transient are retried; a bad login or an
   * exhausted quota fails immediately, because sleeping on those just turns a
   * clear error into a slow one.
   */
  private async invoke(prompt: string): Promise<CliEnvelope> {
    let lastErr: unknown;
    const attempts = this.maxRetries + 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.invokeOnce(prompt);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === attempts - 1 || !isTransient(msg)) throw err;
        await sleep(backoffMs(attempt));
      }
    }
    throw lastErr;
  }

  private async invokeOnce(prompt: string): Promise<CliEnvelope> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      this.model,
      "--tools",
      "", // no filesystem, no network, no shell — this is a completions call
      "--system-prompt",
      HARNESS_SYSTEM_PROMPT,
      "--setting-sources",
      "", // no user/project settings ⇒ no hooks, no stray permissions
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--no-session-persistence",
    ];
    if (this.maxBudgetUsd !== undefined) args.push("--max-budget-usd", String(this.maxBudgetUsd));

    const res = await this.runner(args, prompt, this.timeoutMs);
    if (res.code !== 0) {
      throw new Error(
        `claude CLI exited with code ${res.code ?? "null"}: ${(res.stderr || res.stdout).trim().slice(0, 400)}`,
      );
    }

    const env = parseEnvelope(res.stdout);
    if (!env) {
      throw new Error(`claude CLI returned no JSON envelope: ${res.stdout.trim().slice(0, 200)}`);
    }
    if (env.is_error) {
      throw new Error(`claude CLI reported an error: ${(env.result ?? env.subtype ?? "unknown").slice(0, 400)}`);
    }
    return env;
  }
}

// --- transient-failure policy ------------------------------------------------

/** Retries after the first attempt. Matches the OpenAI/Anthropic SDK default, so
 * one `maxRetries` means the same number of calls whichever provider is in use. */
const DEFAULT_MAX_RETRIES = 2;
const BACKOFF_MS = [1_000, 5_000];

/** Backoff before retry `attempt` (0-based). Beyond the tabulated pair it doubles
 * and caps at a minute: a configured `maxRetries: 8` must not turn into a fixed
 * 5s poll against an endpoint that is telling us to slow down. */
function backoffMs(attempt: number): number {
  const last = BACKOFF_MS[BACKOFF_MS.length - 1];
  return BACKOFF_MS[attempt] ?? Math.min(60_000, last * 2 ** (attempt - BACKOFF_MS.length + 1));
}

/**
 * Retry only what a retry can fix. Quota exhaustion and a missing/expired login
 * are deliberately absent: both persist for far longer than any backoff here, and
 * the user needs to see them now rather than after three sleeps per file.
 */
const TRANSIENT = /\b(overloaded|rate.?limit|429|50[0234]|timed out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|temporarily)\b/i;
const PERMANENT = /\b(usage limit|not found on PATH|invalid api key|\/login|unauthorized|401|403|credit balance)\b/i;

export function isTransient(message: string): boolean {
  if (PERMANENT.test(message)) return false;
  return TRANSIENT.test(message);
}

// Deliberately NOT unref'd: an unref'd backoff lets Node exit while the retry is
// still pending, which would end a build mid-flight instead of resuming it.
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- prompt assembly ---------------------------------------------------------

/**
 * The schema the reply must satisfy. `tool` format borrows the named tool's own
 * parameter schema, so synthesize/crux keep one schema definition rather than
 * maintaining a second copy for this provider.
 */
function schemaFor(req: ChatRequest, fmt: NonNullable<ChatRequest["responseFormat"]>): unknown {
  if (fmt.kind === "tool") return req.tools?.find((t) => t.name === fmt.name)?.parameters ?? { type: "object" };
  if (fmt.kind === "json") return { type: "object" };
  return undefined;
}

/** Flatten the neutral message list into one stdin document. */
function buildPrompt(messages: Message[], schema: unknown): string {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content.trim()).filter(Boolean);
  const rest = messages.filter((m) => m.role !== "system");

  const body =
    rest.length === 1 && rest[0].role === "user"
      ? rest[0].content
      : rest
          .map((m) => {
            const head = m.role === "tool" ? `TOOL RESULT (${m.toolCallId ?? ""})` : m.role.toUpperCase();
            const calls = m.toolCalls?.length ? `\n${JSON.stringify(m.toolCalls)}` : "";
            return `### ${head}\n${m.content}${calls}`;
          })
          .join("\n\n");

  const parts: string[] = [];
  if (system.length) parts.push(`<INSTRUCTIONS>\n${system.join("\n\n")}\n</INSTRUCTIONS>`);
  parts.push(`<INPUT>\n${body}\n</INPUT>`);
  if (schema !== undefined) {
    parts.push(
      "<OUTPUT_FORMAT>\n" +
        "Reply with a SINGLE JSON object and nothing else. No prose before or after it, " +
        "no markdown code fences, no explanation. It must validate against this JSON Schema:\n" +
        JSON.stringify(schema) +
        "\n</OUTPUT_FORMAT>",
    );
  }
  return parts.join("\n\n");
}

function retryPrompt(original: string, bad: string): string {
  return (
    `${original}\n\n<RETRY>\nYour previous reply could not be parsed as JSON. It began:\n` +
    `${bad.slice(0, 300)}\n\nReply again with ONLY the JSON object — first character "{", last character "}".\n</RETRY>`
  );
}

// --- response parsing --------------------------------------------------------

/**
 * `--output-format json` prints one object, but a stray warning line on stdout
 * would break a naive JSON.parse — so fall back to the last JSON-looking line.
 */
function parseEnvelope(stdout: string): CliEnvelope | undefined {
  const trimmed = stdout.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as CliEnvelope;
  } catch {
    // fall through
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as CliEnvelope;
    } catch {
      continue;
    }
  }
  return undefined;
}

/**
 * Pull one JSON value out of a model reply. Handles the two ways a prompt-enforced
 * schema leaks: a markdown fence around the object, and prose either side of it.
 * Brace scanning is string- and escape-aware so a `}` inside a summary can't end
 * the object early. Returns undefined when nothing parses.
 */
export function extractJson(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  for (const candidate of [stripped, text]) {
    try {
      return JSON.parse(candidate);
    } catch {
      // fall through to brace scanning
    }
    const start = candidate.indexOf("{");
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < candidate.length; i++) {
      const ch = candidate[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(candidate.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return undefined;
}

/** The CLI already reports uncached input separately, matching graft's convention. */
function normalizeUsage(u: CliEnvelope["usage"]): Usage {
  return {
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheCreate: u?.cache_creation_input_tokens ?? 0,
  };
}

// --- process plumbing --------------------------------------------------------

/**
 * Resolve the CLI without a shell. Node's spawn only appends `.exe` on Windows,
 * so PATHEXT is walked by hand — the native installer ships `claude.exe` but an
 * `npm i -g` install leaves only the `claude.cmd` shim, and missing it would make
 * this provider look uninstalled on a machine where it works fine.
 */
export function resolveClaudeBin(explicit?: string): string | undefined {
  const name = explicit ?? process.env.GRAFT_CLAUDE_BIN ?? "claude";
  if (name.includes("/") || name.includes("\\")) return existsSync(name) ? name : undefined;

  const exts =
    process.platform === "win32"
      ? [".EXE", ".CMD", ".BAT", ".COM", ""] // .exe first: it spawns without a shim
      : [""];
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir.replace(/^"|"$/g, ""), name + ext);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

let cachedAvailable: boolean | undefined;

/** True when the `claude` CLI is installed. Cached — this runs per build, not per file. */
export function claudeCliAvailable(explicit?: string): boolean {
  if (explicit ?? process.env.GRAFT_CLAUDE_BIN) return !!resolveClaudeBin(explicit);
  if (cachedAvailable === undefined) cachedAvailable = !!resolveClaudeBin();
  return cachedAvailable;
}

/** Test seam: drop the memoized lookup so a test can flip PATH. */
export function resetClaudeCliCache(): void {
  cachedAvailable = undefined;
}

/**
 * `cmd.exe` cannot be handed a `.cmd` file through CreateProcess, so an npm shim
 * has to be run as a command line. Every argument we pass is short and quote-free
 * (the prompt goes over stdin), so quoting each one is enough.
 */
function windowsWrap(bin: string, args: string[]): { file: string; argv: string[]; verbatim: boolean } {
  const isShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
  if (!isShim) return { file: bin, argv: args, verbatim: false };
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const line = [quote(bin), ...args.map(quote)].join(" ");
  return { file: process.env.ComSpec ?? "cmd.exe", argv: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
}

function defaultRunner(bin?: string): ClaudeCliRunner {
  return (args, stdin, timeoutMs) =>
    new Promise<ClaudeCliResult>((resolve, reject) => {
      const resolved = resolveClaudeBin(bin);
      if (!resolved) {
        reject(
          new Error(
            "claude CLI not found on PATH. Install Claude Code (https://claude.com/claude-code) and sign in " +
              "with your subscription, set GRAFT_CLAUDE_BIN to its path, or use an API-key provider " +
              "(GRAFT_PROVIDER=anthropic|openai + GRAFT_API_KEY).",
          ),
        );
        return;
      }

      const { file, argv, verbatim } = windowsWrap(resolved, args);
      const child = spawn(file, argv, {
        // Never the user's repo: cwd is what CLAUDE.md discovery keys off, and a
        // summarization run must not inherit the project's own agent instructions.
        cwd: tmpdir(),
        windowsHide: true,
        windowsVerbatimArguments: verbatim,
        env: {
          ...process.env,
          // Skip the auxiliary Haiku calls (titles, topic detection): pure overhead
          // when a "session" is one summary that is never resumed.
          DISABLE_NON_ESSENTIAL_MODEL_CALLS: "1",
          CLAUDE_CODE_ENTRYPOINT: "graft",
        },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error(`claude CLI timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      timer.unref?.();

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (d: string) => (stdout += d));
      child.stderr.on("data", (d: string) => (stderr += d));
      child.on("error", (err) => finish(() => reject(err)));
      child.on("close", (code) => finish(() => resolve({ code, stdout, stderr })));

      // A CLI that dies before draining stdin gives us EPIPE; the close handler
      // already carries the real diagnosis, so swallow it here.
      child.stdin.on("error", () => {});
      child.stdin.end(stdin, "utf8");
    });
}
