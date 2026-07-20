#!/usr/bin/env node
/**
 * `graft` CLI. Commands:
 *
 *   build   build graft/ from your code (structural graph; --deep adds LLM summaries).
 *   ask     query the graph ($0, no LLM).
 *   check   fail if graft/ has drifted from the code — for CI.
 *   viz     serve the interactive graph viewer.
 *   init    set up the Claude Code integration (.claude/ statusline + hooks) in this repo.
 *
 * Git is the sync: commit graft/ and anyone who clones the repo has the
 * graph, with no setup.
 */
import "dotenv/config";
import { Command } from "commander";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Graft } from "./engine.js";
import { resolveConfig } from "./ai/providers.js";
import { formatCheckReport } from "./context/check.js";
import { formatGraphCheckReport } from "./graph/check.js";
import { runInit } from "./claude/init.js";

const program = new Command();

program
  .name("graft")
  .description("Build a repo's context graph as linked markdown, and keep it in sync with the code.")
  .option("--dir <path>", "context graph directory (default: <repo>/graft)");

function engineFrom(): Graft {
  const opts = program.opts<{ dir?: string }>();
  return new Graft({ contextDir: opts.dir });
}

program
  .command("build")
  .description(
    "Build graft/ from your code — wiring graph + per-file cards ($0, no key). " +
      "Add --deep for the LLM concept map + per-symbol summaries/crux.",
  )
  .argument("[dir]", "repository root", ".")
  .option("--deep", "run the LLM pass: concept nodes (graft/*.md) + per-symbol summary/crux")
  .option("-e, --extensions <exts...>", 'code extensions to include (e.g. ".ts" ".py")')
  .option("-j, --concurrency <n>", "files summarized in parallel during --deep (default 5)")
  .action(async (dir: string, opts: { deep?: boolean; extensions?: string[]; concurrency?: string }) => {
    const concurrency = opts.concurrency ? Math.max(1, Number(opts.concurrency)) : undefined;
    if (opts.concurrency && !Number.isFinite(concurrency)) {
      console.error(`✗ --concurrency must be a number, got "${opts.concurrency}"`);
      process.exit(1);
    }
    const engine = engineFrom();
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");

    // --deep needs a key; without one, degrade to the $0 structural build
    // rather than failing — the wiring graph is still worth having.
    let deep = opts.deep;
    if (deep && !resolveConfig().openrouterApiKey) {
      deep = false;
      console.error(
        "⚠ no OPENROUTER_API_KEY set — falling back to the structural build (no LLM summaries).\n" +
          "  Set OPENROUTER_API_KEY (https://openrouter.ai/keys) and re-run `graft build --deep`\n" +
          "  to add concept nodes and per-symbol summaries.",
      );
    }

    // --deep: concept nodes first (they're LLM prose; the wiring cards link up to
    // them), then the wiring graph rewrites the cards + INDEX with those up-links.
    if (deep) {
      const c = await engine.init(dir, {
        extensions: opts.extensions,
        onProgress: ({ phase, index, total, file }) =>
          process.stderr.write(
            `\r${phase === "summarize" ? "reading" : "writing"} concepts ${index + 1}/${total}: ${file.slice(0, 40).padEnd(40)}`,
          ),
      });
      process.stderr.write("\n");
      console.log(
        `✓ concepts: ${c.nodes} nodes, ${c.links} links from ${c.files} files (${c.summarized} read, ${c.cached} cached)`,
      );
      for (const e of c.errors) console.error(`✗ ${e}`);
    }

    // Wiring graph (Tier-2 cards + Tier-3 wiring.json) — always. LLM meaning only with --deep.
    const g = await engine.graph(dir, {
      llm: deep,
      concurrency,
      onProgress: ({ phase, index, total, file }) =>
        process.stderr.write(
          `\r${phase === "enrich" ? "summarizing" : "parsing"} ${index + 1}/${total}: ${file.slice(0, 50).padEnd(50)}`,
        ),
    });
    process.stderr.write("\n");
    console.log(`✓ wiring: ${g.nodes} nodes (${fmt(g.byKind)}), ${g.edges} edges, ${g.cards} cards [${g.languages.join(", ")}]`);
    if (deep) {
      const m = g.meaning;
      console.log(`  meaning: ${m.computed} computed, ${m.cached} cached, ${m.stale} stale, ${m.pending} pending`);
    }
    console.log(`  → ${g.contextDir}`);
    for (const e of g.errors) console.error(`✗ ${e}`);

    const rel = relative(process.cwd(), g.contextDir) || "graft";
    console.log(`  commit it:  git add ${rel} && git commit -m "update graft"`);
  });

program
  .command("ask")
  .description("Query the graft/ graph — returns ranked nodes + exact file:line, routed to prose or wiring ($0, no key)")
  .argument("<query>", "what you want to understand, in plain words")
  .argument("[dir]", "repository root", ".")
  .option("-n, --limit <n>", "max results", "8")
  .option("--source", "inline the source at each file:line hit (retriever mode — the pack IS the answer, no need to re-open files)")
  .option("--json", "output the result as JSON")
  .action(async (query: string, dir: string, opts: { limit: string; source?: boolean; json?: boolean }) => {
    const engine = engineFrom();
    const r = engine.ask(dir, query, { limit: Number(opts.limit), source: opts.source });
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      const { formatAsk } = await import("./ask/ask.js");
      process.stdout.write(formatAsk(r));
    }
  });

program
  .command("check")
  .description("Fail if graft/ is stale relative to the code (for CI)")
  .argument("[dir]", "repository root", ".")
  .option("-e, --extensions <exts...>", "code extensions to include")
  .option("--json", "output the drift as JSON")
  .action((dir: string, opts: { extensions?: string[]; json?: boolean }) => {
    const engine = engineFrom();
    const r = engine.check(dir, { extensions: opts.extensions });
    const g = engine.checkGraph(dir); // graph.json is only judged when it exists

    if (opts.json) {
      console.log(JSON.stringify({ context: r, graph: g.missing ? null : g }, null, 2));
    } else {
      console.log(formatCheckReport(r));
      if (!g.missing) console.log("\n" + formatGraphCheckReport(g));
    }

    // A missing graph.json is not a failure — the markdown graph stands alone.
    if (!r.ok || (!g.missing && !g.ok)) process.exit(1);
  });

program
  .command("viz")
  .description("Serve an interactive visualization of the context graph (and graph.json when present)")
  .argument("[dir]", "repository root", ".")
  .option("-p, --port <port>", "port to serve on", "4400")
  .option("--no-open", "don't open the browser")
  .action(async (dir: string, opts: { port: string; open: boolean }) => {
    const { existsSync } = await import("node:fs");
    const { resolve, basename } = await import("node:path");
    const { spawn } = await import("node:child_process");
    const { fileURLToPath } = await import("node:url");
    const { contextDirFor } = await import("./context/node-file.js");
    const { startVizServer } = await import("./viz/serve.js");

    const root = resolve(dir);
    const globalOpts = program.opts<{ dir?: string }>();
    const contextDir = contextDirFor(root, globalOpts.dir);
    if (!existsSync(contextDir)) {
      console.error(`✗ no context graph at ${contextDir} — run \`graft build --deep\` first`);
      process.exit(1);
    }
    // dist/cli.js → dist/viewer/ (prebuilt at package build time)
    const viewerDir = fileURLToPath(new URL("./viewer/", import.meta.url));
    const srv = await startVizServer({
      contextDir,
      viewerDir,
      port: Number(opts.port),
      repoName: basename(root),
    });
    console.log(`graft viz → ${srv.url}  (ctrl-c to stop)`);
    if (opts.open) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      spawn(opener, [srv.url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
    }
  });

program
  .command("init")
  .description("Set up the Claude Code integration (.claude/ statusline + hooks) in this repo")
  .argument("[dir]", "target repo directory", ".")
  .option("--no-build", "skip building the graph (wire files only)")
  .action((dir: string, opts: { build?: boolean }) => {
    const cliPath = fileURLToPath(import.meta.url);
    const res = runInit(resolve(dir), { build: opts.build, cliPath });
    console.error(`✓ wrote ${res.settingsPath}`);
    for (const s of res.shims) console.error(`✓ wrote ${s}`);
    console.error(res.built ? "✓ built the graph (graft build)" : "· skipped graph build");
    for (const w of res.warnings) console.error(`⚠ ${w}`);
    console.error("\nDone. The statusline + hooks activate in Claude Code sessions in this repo.");
    console.error("For LLM summaries: set OPENROUTER_API_KEY and run `graft build --deep`.");
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
