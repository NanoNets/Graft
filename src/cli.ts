#!/usr/bin/env node
/**
 * `context-graph` CLI. Two commands:
 *
 *   init    build .context/ from your code (one markdown node per system,
 *           API, or concept; linked to each other; committed to the repo).
 *   check   fail if .context/ has drifted from the code — for CI.
 *
 * Git is the sync: commit .context/ and anyone who clones the repo has the
 * graph, with no setup.
 */
import "dotenv/config";
import { Command } from "commander";
import { relative } from "node:path";
import { ContextGraphEngine } from "./engine.js";
import { formatCheckReport } from "./context/check.js";

const program = new Command();

program
  .name("context-graph")
  .description("Build a repo's context graph as linked markdown, and keep it in sync with the code.")
  .option("--dir <path>", "context graph directory (default: <repo>/.context)")
  .option("--local", "force local Ollama providers even when OPENROUTER_API_KEY is set");

function engineFrom(): ContextGraphEngine {
  const opts = program.opts<{ dir?: string; local?: boolean }>();
  return new ContextGraphEngine({ contextDir: opts.dir, forceLocal: opts.local });
}

program
  .command("init")
  .description("Build .context/ from your code — one markdown node per system, API, or concept")
  .argument("[dir]", "repository root", ".")
  .option("-e, --extensions <exts...>", 'code extensions to include (e.g. ".ts" ".py")')
  .action(async (dir: string, opts: { extensions?: string[] }) => {
    const engine = engineFrom();
    const r = await engine.init(dir, {
      extensions: opts.extensions,
      onProgress: ({ phase, index, total, file }) =>
        process.stderr.write(
          `\r${phase === "summarize" ? "reading" : "writing"} ${index + 1}/${total}: ${file.slice(0, 50).padEnd(50)}`,
        ),
    });
    process.stderr.write("\n");
    console.log(
      `✓ ${r.nodes} nodes, ${r.links} links from ${r.files} files ` +
        `(${r.summarized} read, ${r.cached} cached)`,
    );
    console.log(`  → ${r.contextDir}`);
    for (const e of r.errors) console.error(`✗ ${e}`);
    const rel = relative(process.cwd(), r.contextDir) || ".context";
    console.log(`  commit it:  git add ${rel} && git commit -m "update context graph"`);
  });

program
  .command("check")
  .description("Fail if .context/ is stale relative to the code (for CI)")
  .argument("[dir]", "repository root", ".")
  .option("-e, --extensions <exts...>", "code extensions to include")
  .option("--json", "output the drift as JSON")
  .action((dir: string, opts: { extensions?: string[]; json?: boolean }) => {
    const engine = engineFrom();
    const r = engine.check(dir, { extensions: opts.extensions });
    console.log(opts.json ? JSON.stringify(r, null, 2) : formatCheckReport(r));
    if (!r.ok) process.exit(1);
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
