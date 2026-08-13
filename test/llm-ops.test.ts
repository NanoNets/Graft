/**
 * The three engine ops (summarize / synthesize / crux) over a fake transport —
 * proves each builds the right ChatRequest and parses the response, with no key
 * and no network. Structured ops (synthesize, crux) ride forced tool-calling;
 * summarize is plain text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatSummarizer } from "../src/ai/summarize.js";
import { ChatSynthesizer } from "../src/ai/synthesize.js";
import { ChatCruxSummarizer } from "../src/ai/crux.js";
import type { ChatModel, ChatRequest, ChatResponse, ToolCall } from "../src/ai/llm/types.js";

/** Records the last request and replays a canned response. */
class FakeChatModel implements ChatModel {
  readonly label = "fake:model";
  last?: ChatRequest;
  calls = 0;
  constructor(private reply: { text?: string; toolCalls?: ToolCall[]; stopReason?: string }) {}
  async create(req: ChatRequest): Promise<ChatResponse> {
    this.last = req;
    this.calls++;
    return {
      text: this.reply.text ?? "",
      toolCalls: this.reply.toolCalls ?? [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
      stopReason: this.reply.stopReason ?? "stop",
      assistant: { role: "assistant", content: this.reply.text ?? "" },
    };
  }
}

test("ChatSummarizer sends plain text and returns trimmed content", async () => {
  const m = new FakeChatModel({ text: "  a prose summary  " });
  const out = await new ChatSummarizer(m).summarize("code", { path: "a.ts" });
  assert.equal(out, "a prose summary");
  assert.equal(m.last?.responseFormat, undefined); // plain text
  assert.equal(m.last?.messages[0].role, "system");
});

test("ChatSynthesizer forces record_graph and cleans parsed args", async () => {
  const m = new FakeChatModel({
    toolCalls: [
      {
        id: "1",
        name: "record_graph",
        args: { nodes: [{ name: "Auth", type: "system", summary: "s", sources: ["a.ts"], links: [] }] },
      },
    ],
  });
  const nodes = await new ChatSynthesizer(m).synthesize([{ path: "a.ts", summary: "x" }]);
  assert.deepEqual(m.last?.responseFormat, { kind: "tool", name: "record_graph" });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].name, "Auth");
});

test("ChatCruxSummarizer forces record_symbols and normalizes numbers", async () => {
  const m = new FakeChatModel({
    toolCalls: [
      { id: "1", name: "record_symbols", args: { symbols: [{ id: "sym1", summary: "does x", crux_start: 3.9, crux_end: 5 }] } },
    ],
  });
  const out = await new ChatCruxSummarizer(m).describeFile({
    path: "a.ts",
    source: "l1\nl2\nl3\nl4\nl5\n",
    nodes: [{ id: "sym1", kind: "function", signature: null, startLine: 1, endLine: 5 }],
  });
  assert.deepEqual(m.last?.responseFormat, { kind: "tool", name: "record_symbols" });
  assert.deepEqual(out, [{ id: "sym1", summary: "does x", crux_start: 3, crux_end: 5 }]);
});

test("structured ops degrade gracefully when the model returns no tool call", async () => {
  const empty = new FakeChatModel({ toolCalls: [] });
  assert.deepEqual(await new ChatSynthesizer(empty).synthesize([{ path: "a.ts", summary: "x" }]), []);
  assert.deepEqual(
    await new ChatCruxSummarizer(empty).describeFile({
      path: "a.ts",
      source: "x",
      nodes: [{ id: "s", kind: "function", signature: null, startLine: 1, endLine: 1 }],
    }),
    [],
  );
});

// --- truncation ------------------------------------------------------------
// A turn cut off at max_tokens looks like success at the call site: summarize
// returns the partial text (which build.ts then caches by content hash FOREVER),
// and the structured ops see no closed tool_use block and report "no results" —
// indistinguishable from a model that had nothing to say, so nothing retries.

test("every op REJECTS a turn the model was cut off from finishing", async () => {
  const cut = (reason: string) => new FakeChatModel({ text: "half a sum", stopReason: reason });

  // openai wire format says "length"; the Messages API and the Claude CLI say "max_tokens".
  for (const reason of ["length", "max_tokens"]) {
    await assert.rejects(
      () => new ChatSummarizer(cut(reason)).summarize("code", { path: "a.ts" }),
      /truncated/,
      `summarize must not return a partial summary on stop_reason=${reason}`,
    );
  }

  await assert.rejects(
    () => new ChatSynthesizer(cut("max_tokens")).synthesize([{ path: "a.ts", summary: "x" }]),
    /truncated/,
    "a truncated batch must not be cached as an empty synthesis",
  );

  await assert.rejects(
    () =>
      new ChatCruxSummarizer(cut("max_tokens")).describeFile({
        path: "a.ts",
        source: "l1\nl2\n",
        nodes: [{ id: "s", kind: "function", signature: null, startLine: 1, endLine: 2 }],
      }),
    /truncated/,
    "a truncated crux call must not be reported as 'the model skipped these symbols'",
  );
});

test("single-shot ops turn thinking OFF explicitly, instead of inheriting the provider default", async () => {
  // Current Claude models default to adaptive thinking, and thinking is billed
  // against the SAME maxTokens as the answer — so a 2048-token summarize can come
  // back empty with the budget spent on reasoning nobody asked for.
  const m = new FakeChatModel({ text: "s", toolCalls: [{ id: "1", name: "record_graph", args: { nodes: [] } }] });
  await new ChatSummarizer(m).summarize("code", { path: "a.ts" });
  assert.deepEqual(m.last?.thinking, { kind: "disabled" }, "summarize");
  await new ChatSynthesizer(m).synthesize([{ path: "a.ts", summary: "x" }]);
  assert.deepEqual(m.last?.thinking, { kind: "disabled" }, "synthesize");
  await new ChatCruxSummarizer(m).describeFile({
    path: "a.ts",
    source: "l1\n",
    nodes: [{ id: "s", kind: "function", signature: null, startLine: 1, endLine: 1 }],
  });
  assert.deepEqual(m.last?.thinking, { kind: "disabled" }, "crux");
});

// --- crux: targets must live inside the window that was actually sent --------

/** A file long enough to be clipped, whose Nth line is identifiable. */
function longSource(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `const v${i + 1} = ${"x".repeat(60)};`).join("\n");
}

test("crux asks only about symbols inside the clipped window it actually showed", async () => {
  const source = longSource(600); // ~37k chars — well past the 18k clip
  const m = new FakeChatModel({ toolCalls: [{ id: "1", name: "record_symbols", args: { symbols: [] } }] });
  await new ChatCruxSummarizer(m).describeFile({
    path: "big.ts",
    source,
    nodes: [
      { id: "near", kind: "function", signature: null, startLine: 2, endLine: 5 },
      { id: "far", kind: "function", signature: null, startLine: 560, endLine: 580 },
    ],
  });

  const prompt = m.last?.messages[1].content ?? "";
  const targets = prompt.slice(prompt.indexOf("TARGETS:"));
  assert.match(targets, /id=near/, "a symbol inside the window is still asked about");
  assert.doesNotMatch(
    targets,
    /id=far/,
    "a symbol past the truncation point was never shown — asking for its crux forces the model to invent one",
  );

  // The line numbers in the prompt must stop where the targets do, or a target's
  // L-range points at text the model can't see.
  const lastNumbered = Number(/\n(\d+)\t[^\n]*\n… \(truncated\)/.exec(prompt)?.[1] ?? 0);
  assert.ok(lastNumbered > 0 && lastNumbered < 600, `expected a truncated numbered window, got ${lastNumbered}`);
});

test("crux spends NO call at all when every requested symbol is past the window", async () => {
  const m = new FakeChatModel({ toolCalls: [] });
  const out = await new ChatCruxSummarizer(m).describeFile({
    path: "big.ts",
    source: longSource(600),
    nodes: [{ id: "far", kind: "function", signature: null, startLine: 560, endLine: 580 }],
  });
  assert.deepEqual(out, []);
  assert.equal(m.calls, 0, "enrich.ts re-asks for missing symbols, so this would have cost two useless calls");
});
