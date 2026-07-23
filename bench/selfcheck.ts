/**
 * Offline verification of the harness plumbing — no API key needed. Drives the
 * agent loop, tool execution, judge, and report with a stubbed Claude client so
 * we can confirm control flow end-to-end before spending on a live run.
 *
 *   npx tsx bench/selfcheck.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { runAgent } from "./agent.js";
import { judge } from "./judge.js";
import { buildMarkdown, type Row } from "./report.js";
import type { ChatModel } from "../src/ai/llm/types.js";

const usage = { input: 100, output: 50, cacheRead: 0, cacheCreate: 0 };

/** Stub {@link ChatModel}: agent uses grep then answers; a `json` request is the judge. */
function makeStubModel(): ChatModel {
  let agentTurn = 0;
  return {
    label: "stub:model",
    async create(req) {
      if (req.responseFormat?.kind === "json") {
        const text = JSON.stringify({ correct: true, score: 0.9, reasoning: "matches reference" });
        return { text, toolCalls: [], usage, stopReason: "stop", assistant: { role: "assistant", content: text } };
      }
      // Agent call. First turn: use grep. Second turn: final answer.
      agentTurn++;
      if (agentTurn === 1) {
        const toolCalls = [{ id: "tc_1", name: "grep", args: { pattern: "SECRET_TOKEN" } }];
        return { text: "", toolCalls, usage, stopReason: "tool_use", assistant: { role: "assistant", content: "", toolCalls } };
      }
      const text = "The secret token is SECRET_TOKEN, defined in config.ts.";
      return { text, toolCalls: [], usage, stopReason: "stop", assistant: { role: "assistant", content: text } };
    },
  };
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), "cge-selfcheck-"));
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "config.ts"), "export const token = 'SECRET_TOKEN';\n");

  const model = makeStubModel();

  // 1. Agent loop: should call the grep tool once, then answer.
  const ar = await runAgent({ model, root, question: "What is the secret token?" });
  assert.equal(ar.toolCalls, 1, "expected exactly one tool call");
  assert.equal(ar.toolLog[0].name, "grep", "expected the grep tool to run");
  assert.ok(ar.answer.includes("SECRET_TOKEN"), "answer should contain the fact");
  assert.equal(ar.tokens.total, 300, "tokens should sum across 2 turns (150 each)");
  assert.equal(ar.stopReason, "stop");
  console.log(`✓ agent loop: ${ar.toolCalls} tool call, ${ar.tokens.total} tokens, answer="${ar.answer}"`);

  // 2. Real tool execution actually found the file (grep ran against the temp repo).
  const graphAr = await runAgent({
    model: makeStubModel(),
    root,
    question: "What is the secret token?",
    contextBundle: "# Context\nSECRET_TOKEN lives in config.ts",
  });
  assert.ok(graphAr.answer.includes("SECRET_TOKEN"));
  console.log(`✓ graph arm (bundle injected): answer="${graphAr.answer}"`);

  // 3. Judge: keyword floor + parsed verdict.
  const v = await judge({
    model,
    question: "What is the secret token?",
    referenceAnswer: "SECRET_TOKEN",
    agentAnswer: ar.answer,
    requiredKeywords: ["SECRET_TOKEN"],
  });
  assert.equal(v.keywordPass, true);
  assert.equal(v.judgeCorrect, true);
  assert.equal(v.correct, true);
  assert.equal(v.score, 0.9);
  console.log(`✓ judge: correct=${v.correct} score=${v.score} keywordPass=${v.keywordPass}`);

  // 3b. Keyword floor overrides an over-generous judge.
  const vMiss = await judge({
    model,
    question: "q",
    referenceAnswer: "SECRET_TOKEN",
    agentAnswer: "I could not find it.",
    requiredKeywords: ["SECRET_TOKEN"],
  });
  assert.equal(vMiss.keywordPass, false);
  assert.equal(vMiss.correct, false, "keyword floor must veto the judge's 'correct'");
  console.log(`✓ keyword floor vetoes judge: correct=${vMiss.correct}`);

  // 4. Report renders.
  const rows: Row[] = [
    { corpus: "demo", taskId: "t1", arm: "cold", trial: 1, locality: "multi-file", tokensInput: 5000, tokensOutput: 800, tokensTotal: 5800, cacheRead: 0, cacheCreate: 0, toolCalls: 6, wallMs: 12000, correct: true, score: 0.9, keywordPass: true, judgeCorrect: true, iterations: 4, stopReason: "end_turn", answer: "a", reasoning: "r" },
    { corpus: "demo", taskId: "t1", arm: "graph", trial: 1, locality: "multi-file", tokensInput: 2000, tokensOutput: 400, tokensTotal: 2400, cacheRead: 0, cacheCreate: 0, toolCalls: 1, wallMs: 5000, correct: true, score: 0.92, keywordPass: true, judgeCorrect: true, iterations: 2, stopReason: "end_turn", answer: "a", reasoning: "r" },
  ];
  const md = buildMarkdown(rows);
  assert.ok(md.includes("## demo"));
  assert.ok(md.includes("Total tokens"));
  assert.ok(md.includes("✅"), "graph is cheaper + correctness held → should show a clean win");
  console.log("✓ report renders with cold-vs-graph deltas and verdict");

  console.log("\nAll harness self-checks passed. (Live runs use OPENROUTER_API_KEY.)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
