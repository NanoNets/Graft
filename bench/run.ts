/**
 * Benchmark orchestrator.
 *
 *   npm run bench                       # full run: all corpora, all tasks, 3 trials
 *   npm run bench -- --smoke            # 1 corpus, 1 task, 1 trial (plumbing check)
 *   npm run bench -- --corpora context-engine --tasks 3 --trials 2
 *   npm run bench -- --arms cold,pull   # subset of arms
 *
 * Three arms, identical agent loop:
 *   cold  — filesystem tools only, from zero.
 *   graph — same, plus a pre-computed `graft ask --source` bundle injected
 *           up front (push: the bundle is paid whether or not it helps).
 *   pull  — same tools plus graft_ask/graft_skeleton over the prebuilt graph;
 *           nothing injected — graph context is paid only when requested.
 *
 * Needs OPENROUTER_API_KEY for the agent (Sonnet 5) and judge (Opus 4.8).
 * The graph itself builds keyless (Tier-1 tree-sitter, $0) into a temp dir —
 * corpora repos are never written to. Override models with BENCH_AGENT_MODEL /
 * BENCH_JUDGE_MODEL.
 */
import "dotenv/config";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph } from "../src/graph/build.js";
import { ask, formatAsk } from "../src/ask/ask.js";
import { CORPORA } from "./tasks.js";
import { runAgent } from "./agent.js";
import { judge } from "./judge.js";
import { makeChatModel, AGENT_MODEL, JUDGE_MODEL } from "./llm.js";
import { resolveConfig } from "../src/ai/providers.js";
import { buildMarkdown, type Row, type Arm } from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));

const ALL_ARMS: Arm[] = ["cold", "graph", "pull"];

interface Args {
  corpora?: string[];
  tasks?: number;
  trials: number;
  arms: Arm[];
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { trials: 3, arms: [...ALL_ARMS], concurrency: 6 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--smoke") {
      a.corpora = ["context-engine"]; // self-contained — always present
      a.tasks = 1;
      a.trials = 1;
    } else if (arg === "--corpora" || arg === "--repos") a.corpora = argv[++i].split(",");
    else if (arg === "--tasks") a.tasks = Number(argv[++i]);
    else if (arg === "--trials") a.trials = Number(argv[++i]);
    else if (arg === "--arms") a.arms = argv[++i].split(",") as Arm[];
    else if (arg === "--concurrency") a.concurrency = Math.max(1, Number(argv[++i]));
  }
  const bad = a.arms.filter((x) => !ALL_ARMS.includes(x));
  if (bad.length) {
    console.error(`Unknown arm(s): ${bad.join(", ")}. Valid: ${ALL_ARMS.join(", ")}`);
    process.exit(1);
  }
  return a;
}

/** Run items through `fn` with at most `n` in flight. Independent agent/judge calls, so safe to parallelize. */
async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!resolveConfig().apiKey) {
    console.error("Set GRAFT_API_KEY (or OPENROUTER_API_KEY) — the agent and judge need a provider key.");
    process.exit(1);
  }
  const agentModel = makeChatModel(AGENT_MODEL);
  const judgeModel = makeChatModel(JUDGE_MODEL);

  const corpora = CORPORA.filter((c) => !args.corpora || args.corpora.includes(c.id));
  if (corpora.length === 0) {
    console.error(`No matching corpora. Available: ${CORPORA.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  const tmpDirs: string[] = [];

  for (const corpus of corpora) {
    if (corpus.kind === "docs") {
      console.log(`\n=== corpus: ${corpus.id} — SKIPPED (wiring graph indexes code only; no docs ingestion) ===`);
      continue;
    }
    if (!existsSync(corpus.path)) {
      console.log(`\n=== corpus: ${corpus.id} — SKIPPED (path not found: ${corpus.path}) ===`);
      continue;
    }
    const tasks = args.tasks ? corpus.tasks.slice(0, args.tasks) : corpus.tasks;
    console.log(`\n=== corpus: ${corpus.id} — ${tasks.length} tasks × ${args.arms.length} arms × ${args.trials} trials ===`);

    // Build the wiring graph once per corpus into a TEMP contextDir — Tier-1
    // tree-sitter only ($0, keyless), and the corpus repo is never written to.
    const graftDir = mkdtempSync(join(tmpdir(), "graft-bench-ctx-"));
    tmpDirs.push(graftDir);
    const t0 = Date.now();
    const g = await buildGraph(corpus.path, {
      contextDir: graftDir,
      onProgress: (p) => process.stdout.write(`\r  build: ${p.phase} ${p.index + 1}/${p.total}   `),
    });
    console.log(`\n  graph: ${g.nodes} nodes / ${g.edges} edges in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (g.errors.length) console.log(`  build errors: ${g.errors.length} (first: ${g.errors[0]})`);

    // Precompute each task's push bundle once (reused across trials). `ask` is
    // deterministic and local, so doing it up front keeps the pool self-contained.
    const bundles = new Map<string, string>();
    if (args.arms.includes("graph")) {
      for (const task of tasks) {
        bundles.set(task.id, formatAsk(ask(corpus.path, task.question, { contextDir: graftDir, source: true, limit: 5 })));
      }
    }

    // Every (task, arm, trial) is an independent unit — run them through a bounded pool.
    const units: Array<{ task: (typeof tasks)[number]; arm: Arm; trial: number }> = [];
    for (const task of tasks) for (const arm of args.arms) for (let trial = 1; trial <= args.trials; trial++) units.push({ task, arm, trial });

    let done = 0;
    const total = units.length;
    const corpusRows = await pool(units, args.concurrency, async ({ task, arm, trial }) => {
      const base = {
        corpus: corpus.id, taskId: task.id, arm, trial,
        locality: task.locality ?? "multi-file",
      };
      try {
        const ar = await runAgent({
          model: agentModel,
          root: corpus.path,
          question: task.question,
          contextBundle: arm === "graph" ? bundles.get(task.id) : undefined,
          graft: arm === "pull" ? { contextDir: graftDir } : undefined,
        });
        const v = await judge({
          model: judgeModel,
          question: task.question,
          referenceAnswer: task.referenceAnswer,
          agentAnswer: ar.answer,
          requiredKeywords: task.requiredKeywords,
        });
        console.log(`  (${++done}/${total}) [${task.id}] ${arm} t${trial}: ${v.correct ? "✓" : "✗"} ${ar.tokens.total} tok, ${ar.toolCalls} tools, ${(ar.wallMs / 1000).toFixed(1)}s`);
        return {
          ...base,
          tokensInput: ar.tokens.input, tokensOutput: ar.tokens.output, tokensTotal: ar.tokens.total,
          cacheRead: ar.tokens.cacheRead, cacheCreate: ar.tokens.cacheCreate,
          toolCalls: ar.toolCalls, wallMs: ar.wallMs,
          correct: v.correct, score: v.score, keywordPass: v.keywordPass, judgeCorrect: v.judgeCorrect,
          iterations: ar.iterations, stopReason: ar.stopReason, answer: ar.answer, reasoning: v.reasoning,
        } as Row;
      } catch (e) {
        // Non-fatal: record the failure and keep going so one error can't sink the run.
        console.log(`  (${++done}/${total}) [${task.id}] ${arm} t${trial}: ERROR ${e instanceof Error ? e.message : String(e)}`);
        return {
          ...base,
          tokensInput: 0, tokensOutput: 0, tokensTotal: 0, cacheRead: 0, cacheCreate: 0,
          toolCalls: 0, wallMs: 0, correct: false, score: 0, keywordPass: false,
          judgeCorrect: false, iterations: 0, stopReason: "error", answer: "",
          reasoning: `run error: ${e instanceof Error ? e.message : String(e)}`,
        } as Row;
      }
    });
    rows.push(...corpusRows);
  }

  if (rows.length === 0) {
    console.error("\nNo runnable corpora (all skipped).");
    process.exit(1);
  }

  // Write results + summary. Timestamp comes from Date (fine in a standalone script).
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = join(here, "results");
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, `${stamp}.json`);
  const mdPath = join(outDir, `${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify({ generatedAt: stamp, rows }, null, 2));
  const md = buildMarkdown(rows);
  writeFileSync(mdPath, md);

  console.log("\n" + md);
  console.log(`\nRaw rows → ${jsonPath}`);
  console.log(`Summary  → ${mdPath}`);

  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
