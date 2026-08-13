/**
 * Process-free tests for the subscription transport. The adapter takes an
 * injectable runner, so every case here asserts both directions of the
 * translation (neutral → argv/stdin, CLI envelope → neutral) without ever
 * spawning `claude`, hitting the network, or needing a key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ClaudeCliChatModel, extractJson, isTransient, resolveClaudeBin } from "../src/ai/llm/claude-cli.js";
import { createChatModel, providerNeedsKey } from "../src/ai/llm/factory.js";
import { credentialProblem, resolveConfig } from "../src/ai/providers.js";
import type { ClaudeCliResult } from "../src/ai/llm/claude-cli.js";

/** A path that certainly exists (this file) — stands in for an installed CLI. */
const REAL_PATH = fileURLToPath(import.meta.url);
const MISSING_PATH = `${REAL_PATH}.does-not-exist`;

function envelope(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "hello",
    stop_reason: "end_turn",
    usage: {
      input_tokens: 70,
      output_tokens: 20,
      cache_read_input_tokens: 30,
      cache_creation_input_tokens: 5,
    },
    ...over,
  });
}

/** Records every invocation and replays canned stdout, one response per call. */
function fakeRunner(responses: Array<Partial<ClaudeCliResult> | string>) {
  const calls: Array<{ args: string[]; stdin: string; timeoutMs: number }> = [];
  const run = async (args: string[], stdin: string, timeoutMs: number): Promise<ClaudeCliResult> => {
    calls.push({ args, stdin, timeoutMs });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    const base = typeof r === "string" ? { stdout: r } : r;
    return { code: 0, stdout: "", stderr: "", ...base };
  };
  return { run, calls };
}

/** Read the value that follows a flag in the recorded argv. */
const flagValue = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

// --- plain text --------------------------------------------------------------

test("claude-cli: text — argv isolates the CLI and usage is normalized", async () => {
  const { run, calls } = fakeRunner([envelope()]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create({
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ],
    temperature: 0,
  });

  const { args, stdin } = calls[0];
  assert.equal(flagValue(args, "--model"), "sonnet");
  assert.equal(flagValue(args, "--output-format"), "json");
  assert.ok(args.includes("-p"));
  // The isolation flags are the whole reason this is safe to run over a repo.
  assert.equal(flagValue(args, "--tools"), "", "every built-in tool must be off");
  assert.equal(flagValue(args, "--setting-sources"), "", "user hooks/settings must not load");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.ok(args.includes("--disable-slash-commands"));
  assert.ok(args.includes("--no-session-persistence"));
  // graft's own system prompt rides in stdin; argv carries only the short harness one.
  assert.ok(!flagValue(args, "--system-prompt").includes("sys"));
  assert.match(stdin, /<INSTRUCTIONS>\nsys\n<\/INSTRUCTIONS>/);
  assert.match(stdin, /<INPUT>\nhi\n<\/INPUT>/);
  assert.ok(!stdin.includes("<OUTPUT_FORMAT>"), "no schema block for a text call");

  assert.equal(res.text, "hello");
  assert.deepEqual(res.toolCalls, []);
  assert.equal(res.stopReason, "end_turn");
  assert.deepEqual(res.usage, { input: 70, output: 20, cacheRead: 30, cacheCreate: 5 });
  assert.equal(res.assistant.role, "assistant");
});

test("claude-cli: a single user message is sent verbatim, multi-turn gets role headers", async () => {
  const { run, calls } = fakeRunner([envelope(), envelope()]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });

  await m.create({ messages: [{ role: "user", content: "just this" }] });
  assert.match(calls[0].stdin, /<INPUT>\njust this\n<\/INPUT>/);

  await m.create({
    messages: [
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
      { role: "user", content: "q2" },
    ],
  });
  assert.match(calls[1].stdin, /### USER\nq/);
  assert.match(calls[1].stdin, /### ASSISTANT\na/);
});

// --- structured output -------------------------------------------------------

const RECORD_TOOL = {
  name: "record_graph",
  description: "Record nodes.",
  parameters: { type: "object", properties: { nodes: { type: "array" } }, required: ["nodes"] },
};

const toolReq = {
  tools: [RECORD_TOOL],
  responseFormat: { kind: "tool", name: "record_graph" } as const,
  messages: [{ role: "user" as const, content: "summaries" }],
};

test("claude-cli: tool format — schema is prompted and the reply becomes a tool call", async () => {
  const { run, calls } = fakeRunner([envelope({ result: '{"nodes":[{"name":"Auth"}]}' })]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create(toolReq);

  // No tool_choice on this wire, so the schema has to travel in the prompt.
  assert.match(calls[0].stdin, /<OUTPUT_FORMAT>/);
  assert.ok(calls[0].stdin.includes('"required":["nodes"]'), "the tool's own schema is inlined");

  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, "record_graph");
  assert.deepEqual(res.toolCalls[0].args, { nodes: [{ name: "Auth" }] });
  assert.equal(res.text, "", "text is empty when the turn is a forced tool call");
});

test("claude-cli: json format returns the object re-serialized as text", async () => {
  const { run } = fakeRunner([envelope({ result: '{"a":1}' })]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create({
    responseFormat: { kind: "json" },
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(res.text, '{"a":1}');
  assert.deepEqual(res.toolCalls, []);
});

test("claude-cli: a fenced or prose-wrapped object still parses", async () => {
  for (const raw of [
    '```json\n{"nodes":[]}\n```',
    'Here you go:\n{"nodes":[]}\nHope that helps!',
    '{"nodes":[{"summary":"uses } and { in prose"}]}',
  ]) {
    const { run } = fakeRunner([envelope({ result: raw })]);
    const m = new ClaudeCliChatModel({ model: "sonnet", run });
    const res = await m.create(toolReq);
    assert.ok(res.toolCalls[0], `failed to recover JSON from: ${raw}`);
  }
});

test("claude-cli: unparseable output retries once, quoting the bad reply back", async () => {
  const { run, calls } = fakeRunner([
    envelope({ result: "I'm sorry, I can't do that." }),
    envelope({ result: '{"nodes":[]}' }),
  ]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create(toolReq);

  assert.equal(calls.length, 2, "exactly one corrective retry");
  assert.match(calls[1].stdin, /<RETRY>/);
  assert.match(calls[1].stdin, /I'm sorry/);
  assert.deepEqual(res.toolCalls[0].args, { nodes: [] });
});

test("claude-cli: still unparseable after the retry fails loudly", async () => {
  const { run, calls } = fakeRunner([envelope({ result: "nope" })]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  await assert.rejects(() => m.create(toolReq), /did not return parseable JSON/);
  assert.equal(calls.length, 2);
});

// --- failure surfaces --------------------------------------------------------

test("claude-cli: a non-zero exit surfaces stderr, not a JSON parse error", async () => {
  const { run } = fakeRunner([{ code: 1, stderr: "Invalid API key · Please run /login" }]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  await assert.rejects(() => m.create({ messages: [{ role: "user", content: "x" }] }), /Please run \/login/);
});

test("claude-cli: is_error in the envelope is an error, not an empty summary", async () => {
  const { run } = fakeRunner([envelope({ is_error: true, result: "usage limit reached" })]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  await assert.rejects(() => m.create({ messages: [{ role: "user", content: "x" }] }), /usage limit reached/);
});

test("isTransient: retries blips, never a login or quota problem", () => {
  for (const m of ["Overloaded", "rate limit exceeded", "HTTP 503", "claude CLI timed out after 300000ms", "ECONNRESET"]) {
    assert.equal(isTransient(m), true, m);
  }
  // A backoff cannot fix these, and sleeping on them hides the real diagnosis.
  for (const m of [
    "usage limit reached",
    "Invalid API key · Please run /login",
    "claude CLI not found on PATH",
    "your credit balance is too low",
    "rate limit exceeded — usage limit reached", // permanent wins over transient
  ]) {
    assert.equal(isTransient(m), false, m);
  }
});

test("claude-cli: a transient failure is retried, and the result is kept", async () => {
  const { run, calls } = fakeRunner([{ code: 1, stderr: "Overloaded" }, envelope()]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create({ messages: [{ role: "user", content: "x" }] });
  assert.equal(calls.length, 2);
  assert.equal(res.text, "hello");
});

test("claude-cli: maxRetries decides how many attempts a transient failure gets", async () => {
  // `maxRetries: 0` is the setting for a machine where the CLI is not signed in:
  // every attempt fails identically, and three of them per file (with backoff)
  // turns a clear error into a very slow one. The count was a hard-coded 3.
  const { run, calls } = fakeRunner([
    { code: 1, stderr: "Overloaded" },
    { code: 1, stderr: "Overloaded" },
    envelope(),
  ]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run, maxRetries: 0 });
  await assert.rejects(() => m.create({ messages: [{ role: "user", content: "x" }] }), /Overloaded/);
  assert.equal(calls.length, 1, "no retry means exactly one call");
});

test("claude-cli: a permanent failure fails on the first attempt, not after backoff", async () => {
  const { run, calls } = fakeRunner([{ code: 1, stderr: "Invalid API key · Please run /login" }]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  await assert.rejects(() => m.create({ messages: [{ role: "user", content: "x" }] }), /login/);
  assert.equal(calls.length, 1, "a login problem must surface immediately");
});

test("claude-cli: a warning line before the envelope does not break parsing", async () => {
  const { run } = fakeRunner([`warning: something\n${envelope()}`]);
  const m = new ClaudeCliChatModel({ model: "sonnet", run });
  const res = await m.create({ messages: [{ role: "user", content: "x" }] });
  assert.equal(res.text, "hello");
});

// --- JSON recovery -----------------------------------------------------------

test("extractJson: brace scanning is string- and escape-aware", () => {
  assert.deepEqual(extractJson('{"s":"a } b"}'), { s: "a } b" });
  assert.deepEqual(extractJson('{"s":"esc \\" then }"}'), { s: 'esc " then }' });
  assert.deepEqual(extractJson('pre {"a":{"b":1}} post'), { a: { b: 1 } });
  assert.equal(extractJson("no json here"), undefined);
  assert.equal(extractJson('{"unterminated": '), undefined);
});

// --- wiring ------------------------------------------------------------------

test("factory: claude-cli builds with no key; key providers still demand one", () => {
  assert.equal(providerNeedsKey("claude-cli"), false);
  assert.equal(providerNeedsKey("anthropic"), true);
  const m = createChatModel({ provider: "claude-cli", model: "sonnet", bin: MISSING_PATH });
  assert.equal(m.label, "claude-cli:sonnet");
  assert.throws(() => createChatModel({ provider: "anthropic", model: "x" }), /needs an API key/);
});

test("resolveClaudeBin: an explicit path is trusted only when it exists", () => {
  assert.equal(resolveClaudeBin(REAL_PATH), REAL_PATH);
  assert.equal(resolveClaudeBin(MISSING_PATH), undefined);
});

/** Run `fn` with a scrubbed provider environment, restoring it afterwards. */
function withEnv(over: Record<string, string | undefined>, fn: () => void): void {
  const keys = ["GRAFT_PROVIDER", "GRAFT_API_KEY", "OPENROUTER_API_KEY", "GRAFT_MODEL", "GRAFT_CLAUDE_BIN"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  for (const [k, v] of Object.entries(over)) if (v !== undefined) process.env[k] = v;
  try {
    fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

test("resolveConfig: no key + a local CLI picks claude-cli, and says it inferred it", () => {
  withEnv({ GRAFT_CLAUDE_BIN: REAL_PATH }, () => {
    const c = resolveConfig();
    assert.equal(c.provider, "claude-cli");
    assert.equal(c.model, "sonnet");
    assert.equal(c.autoDetectedProvider, true);
    assert.equal(credentialProblem(c), undefined);
  });
});

test("resolveConfig: an existing key-based setup is untouched by the new provider", () => {
  withEnv({ GRAFT_API_KEY: "sk-test", GRAFT_CLAUDE_BIN: REAL_PATH }, () => {
    const c = resolveConfig();
    assert.equal(c.provider, "openai", "a configured key must never be silently bypassed");
    assert.equal(c.autoDetectedProvider, false);
  });
});

test("resolveConfig: an explicit provider always wins over inference", () => {
  withEnv({ GRAFT_PROVIDER: "anthropic", GRAFT_CLAUDE_BIN: REAL_PATH }, () => {
    const c = resolveConfig();
    assert.equal(c.provider, "anthropic");
    assert.equal(c.autoDetectedProvider, false);
    assert.match(credentialProblem(c)!, /No API key/);
  });
});

test("resolveConfig: no key and no CLI keeps the old default and the old complaint", () => {
  withEnv({ GRAFT_CLAUDE_BIN: MISSING_PATH }, () => {
    const c = resolveConfig();
    assert.equal(c.provider, "openai");
    assert.match(credentialProblem(c)!, /No API key/);
  });
});

test("credentialProblem: claude-cli without the binary explains how to fix it", () => {
  withEnv({ GRAFT_PROVIDER: "claude-cli", GRAFT_CLAUDE_BIN: MISSING_PATH }, () => {
    const c = resolveConfig();
    assert.match(credentialProblem(c)!, /not on PATH/);
  });
});

test("credentialProblem: an injected chatModel needs no credentials at all", () => {
  withEnv({ GRAFT_CLAUDE_BIN: MISSING_PATH }, () => {
    const c = resolveConfig({ chatModel: { label: "stub", create: async () => ({}) as never } });
    assert.equal(credentialProblem(c), undefined);
  });
});
