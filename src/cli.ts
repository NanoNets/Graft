#!/usr/bin/env node
/**
 * `graft` CLI. Two commands:
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
import { Graft } from "./engine.js";
import { formatCheckReport } from "./context/check.js";
import { formatGraphCheckReport } from "./graph/check.js";

const program = new Command();

program
  .name("graft")
  .description("Build a repo's context graph as linked markdown, and keep it in sync with the code.")
  .option("--dir <path>", "context graph directory (default: <repo>/.context)");

function engineFrom(): Graft {
  const opts = program.opts<{ dir?: string }>();
  return new Graft({ contextDir: opts.dir });
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
  .command("graph")
  .description("Build .context/graph.json — a per-symbol code graph (tree-sitter structure + optional LLM meaning)")
  .argument("[dir]", "repository root", ".")
  .option("--llm", "run the Tier-2 LLM pass (summary + crux); unchanged bodies are served from cache")
  .action(async (dir: string, opts: { llm?: boolean }) => {
    const engine = engineFrom();
    const r = await engine.graph(dir, {
      llm: opts.llm,
      onProgress: ({ phase, index, total, file }) =>
        process.stderr.write(
          `\r${phase === "enrich" ? "summarizing" : "parsing"} ${index + 1}/${total}: ${file.slice(0, 50).padEnd(50)}`,
        ),
    });
    process.stderr.write("\n");
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
    console.log(`✓ ${r.nodes} nodes (${fmt(r.byKind)}) from ${r.files} files [${r.languages.join(", ")}]`);
    console.log(`  ${r.edges} edges (${fmt(r.byRelation)})`);
    const m = r.meaning;
    console.log(
      `  meaning: ${m.computed} computed, ${m.cached} cached, ${m.stale} stale, ${m.pending} pending`,
    );
    console.log(`  → ${r.graphPath}`);
    for (const e of r.errors) console.error(`✗ ${e}`);
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
      console.error(`✗ no context graph at ${contextDir} — run \`graft init\` first`);
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

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
