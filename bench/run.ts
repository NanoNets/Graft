/**
 * Benchmark orchestrator.
 *
 *   npm run bench                       # full run: all corpora, all tasks, 3 trials
 *   npm run bench -- --smoke            # 1 corpus, 1 task, 1 trial (plumbing check)
 *   npm run bench -- --corpora context-engine --tasks 3 --trials 2
 *   npm run bench -- --arms graph       # one arm only
 *
 * Needs OPENROUTER_API_KEY only — the agent (Sonnet 5), judge (Opus 4.8), and
 * graph extraction all run through OpenRouter. Override models with
 * BENCH_AGENT_MODEL / BENCH_JUDGE_MODEL.
 */
import "dotenv/config";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ContextGraphEngine } from "../src/index.js";
import { DOC_EXTENSIONS } from "../src/ingest/fs.js";
import { extractPdfText, isPdfPath } from "../src/ingest/pdf.js";
import { CORPORA, type Corpus } from "./tasks.js";
import { runAgent } from "./agent.js";
import { judge } from "./judge.js";
import { makeClient } from "./llm.js";
import { buildMarkdown, type Row } from "./report.js";

const here = dirname(fileURLToPath(import.meta.url));

interface Args {
  corpora?: string[];
  tasks?: number;
  trials: number;
  arms: Array<"cold" | "graph">;
  concurrency: number;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { trials: 3, arms: ["cold", "graph"], concurrency: 6 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--smoke") {
      a.corpora = ["unified-accounts-login-server"]; // smallest corpus — cheapest plumbing check
      a.tasks = 1;
      a.trials = 1;
    } else if (arg === "--corpora" || arg === "--repos") a.corpora = argv[++i].split(",");
    else if (arg === "--tasks") a.tasks = Number(argv[++i]);
    else if (arg === "--trials") a.trials = Number(argv[++i]);
    else if (arg === "--arms") a.arms = argv[++i].split(",") as Array<"cold" | "graph">;
    else if (arg === "--concurrency") a.concurrency = Math.max(1, Number(argv[++i]));
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

/** For a docs corpus, build a temp dir of plaintext the cold agent can read/grep (PDFs → .txt). */
async function makeDocsWorkdir(corpus: Corpus): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "cge-bench-docs-"));
  const files = readdirSync(corpus.path).filter((f) => DOC_EXTENSIONS.some((e) => f.toLowerCase().endsWith(e)));
  for (const f of files) {
    const src = join(corpus.path, f);
    if (isPdfPath(f)) {
      const text = await extractPdfText(src);
      writeFileSync(join(dir, f.replace(/\.pdf$/i, ".txt")), text);
    } else {
      copyFileSync(src, join(dir, f));
    }
  }
  return dir;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("Set OPENROUTER_API_KEY (agent, judge, and graph extraction all run through OpenRouter).");
    process.exit(1);
  }
  const client = makeClient();

  const corpora = CORPORA.filter((c) => !args.corpora || args.corpora.includes(c.id));
  if (corpora.length === 0) {
    console.error(`No matching corpora. Available: ${CORPORA.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }

  const rows: Row[] = [];
  const tmpDbDirs: string[] = [];

  for (const corpus of corpora) {
    const tasks = args.tasks ? corpus.tasks.slice(0, args.tasks) : corpus.tasks;
    console.log(`\n=== corpus: ${corpus.id} (${corpus.kind}) — ${tasks.length} tasks × ${args.trials} trials ===`);

    // Fresh temp-backed engine; ingest once and reuse for the whole corpus.
    const dbDir = mkdtempSync(join(tmpdir(), "cge-bench-db-"));
    tmpDbDirs.push(dbDir);
    const engine = new ContextGraphEngine({ dbPath: join(dbDir, "graph.db") });

    let agentRoot = corpus.path;
    let docsWorkdir: string | undefined;

    try {
      const t0 = Date.now();
      if (corpus.kind === "repo") {
        const r = await engine.ingestRepo(corpus.path, {
          onProgress: (p) => process.stdout.write(`\r  ingest: ${p.phase} ${p.index + 1}/${p.total}   `),
        });
        console.log(`\n  ingested repo: ${r.files} files (${r.summarized} summarized, ${r.cached} cached) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        if (r.errors.length) console.log(`  ingest errors: ${r.errors.length} (first: ${r.errors[0]})`);
      } else {
        docsWorkdir = await makeDocsWorkdir(corpus);
        agentRoot = docsWorkdir;
        const res = await engine.ingestDir(corpus.path);
        console.log(`  ingested docs: ${res.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      }
      const stats = await engine.stats();
      console.log(`  graph: ${stats.nodes} entities, ${stats.edges} relationships, ${stats.chunks} chunks`);

      // Precompute each task's graph bundle once (reused across arms/trials). engine.read
      // is fast and local; do it up front so the parallel pool below never touches the engine.
      const bundles = new Map<string, string>();
      for (const task of tasks) {
        bundles.set(task.id, args.arms.includes("graph") ? (await engine.read(task.question)).prompt : "");
      }

      // Every (task, arm, trial) is an independent unit — run them through a bounded pool.
      const units: Array<{ task: (typeof tasks)[number]; arm: "cold" | "graph"; trial: number }> = [];
      for (const task of tasks) for (const arm of args.arms) for (let trial = 1; trial <= args.trials; trial++) units.push({ task, arm, trial });

      let done = 0;
      const total = units.length;
      const corpusRows = await pool(units, args.concurrency, async ({ task, arm, trial }) => {
        try {
          const ar = await runAgent({
            client,
            root: agentRoot,
            question: task.question,
            contextBundle: arm === "graph" ? bundles.get(task.id) : undefined,
          });
          const v = await judge({
            client,
            question: task.question,
            referenceAnswer: task.referenceAnswer,
            agentAnswer: ar.answer,
            requiredKeywords: task.requiredKeywords,
          });
          console.log(`  (${++done}/${total}) [${task.id}] ${arm} t${trial}: ${v.correct ? "✓" : "✗"} ${ar.tokens.total} tok, ${ar.toolCalls} tools, ${(ar.wallMs / 1000).toFixed(1)}s`);
          return {
            corpus: corpus.id, taskId: task.id, arm, trial,
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
            corpus: corpus.id, taskId: task.id, arm, trial,
            tokensInput: 0, tokensOutput: 0, tokensTotal: 0, cacheRead: 0, cacheCreate: 0,
            toolCalls: 0, wallMs: 0, correct: false, score: 0, keywordPass: false,
            judgeCorrect: false, iterations: 0, stopReason: "error", answer: "",
            reasoning: `run error: ${e instanceof Error ? e.message : String(e)}`,
          } as Row;
        }
      });
      rows.push(...corpusRows);
    } finally {
      await engine.close();
      if (docsWorkdir) rmSync(docsWorkdir, { recursive: true, force: true });
    }
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

  for (const d of tmpDbDirs) rmSync(d, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
