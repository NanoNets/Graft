#!/usr/bin/env node
/**
 * `context-graph` CLI — a thin wrapper over {@link ContextGraphEngine} for use
 * from the shell. Subcommands mirror the engine's core verbs:
 *
 *   ingest / ingest-text  build the graph from docs
 *   query                 read the graph for a query (the agent's "read context")
 *   contribute            write a learning back into the graph
 *   stats                 report how much the graph holds
 *
 * A `--db <path>` flag (or CONTEXT_GRAPH_DB) selects which graph file to use.
 */
import "dotenv/config";
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import { ContextGraphEngine } from "./engine.js";
import { GraphWatcher, type WatchEvent } from "./watch.js";
import { resolveConfig } from "./ai/providers.js";
import { toHtml, toMermaid } from "./graph/export.js";

const program = new Command();

program
  .name("context-graph")
  .description("Turn docs into a structured context graph that AI agents read from and write back to.")
  .option("--db <path>", "path to the graph database (overrides CONTEXT_GRAPH_DB)");

function engineFrom(): ContextGraphEngine {
  const opts = program.opts<{ db?: string }>();
  return new ContextGraphEngine({ dbPath: opts.db });
}

program
  .command("ingest")
  .description("Ingest one or more files into the graph")
  .argument("<paths...>", "files to ingest")
  .option("-t, --title <title>", "title override (single file only)")
  .action(async (paths: string[], opts: { title?: string }) => {
    const engine = engineFrom();
    try {
      for (const path of paths) {
        const r = await engine.ingestFile(path, { title: paths.length === 1 ? opts.title : undefined });
        if (r.skipped) {
          console.log(`• ${r.title} — already ingested, skipped`);
        } else {
          console.log(
            `✓ ${r.title} — ${r.chunks} chunks, +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), +${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
          );
        }
      }
    } finally {
      await engine.close();
    }
  });

program
  .command("ingest-text")
  .description("Ingest text passed as an argument or piped via stdin")
  .argument("[text]", "text to ingest (or pipe via stdin)")
  .option("-t, --title <title>", "document title", "inline")
  .action(async (text: string | undefined, opts: { title: string }) => {
    const engine = engineFrom();
    try {
      const content = text ?? readFileSync(0, "utf8");
      const r = await engine.ingest(content, { title: opts.title });
      console.log(
        r.skipped
          ? `• already ingested, skipped`
          : `✓ ${r.chunks} chunks, +${r.nodesCreated} nodes, +${r.edgesCreated} edges`,
      );
    } finally {
      await engine.close();
    }
  });

program
  .command("query")
  .description("Read the graph for a query and print the context bundle")
  .argument("<text>", "the query")
  .option("--json", "output the full bundle as JSON")
  .option("-n, --max-nodes <n>", "max entities to surface", (v) => parseInt(v, 10), 8)
  .option("-c, --max-chunks <n>", "max source passages to surface", (v) => parseInt(v, 10), 6)
  .action(async (text: string, opts: { json?: boolean; maxNodes: number; maxChunks: number }) => {
    const engine = engineFrom();
    try {
      const bundle = await engine.read(text, {
        maxNodes: opts.maxNodes,
        maxChunks: opts.maxChunks,
      });
      console.log(opts.json ? JSON.stringify(bundle, null, 2) : bundle.prompt);
    } finally {
      await engine.close();
    }
  });

program
  .command("contribute")
  .description("Contribute a learning back into the graph")
  .argument("<text>", "the learning to record")
  .option("-a, --agent <id>", "agent identifier", "cli")
  .action(async (text: string, opts: { agent: string }) => {
    const engine = engineFrom();
    try {
      const r = await engine.contribute(text, { agentId: opts.agent });
      console.log(
        `✓ contributed — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), +${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
      );
    } finally {
      await engine.close();
    }
  });

program
  .command("ingest-dir")
  .description("Ingest every supported doc (.pdf .md .txt) in a directory, recursively")
  .argument("<dir>", "directory to ingest")
  .option("-w, --watch", "also register the directory for auto-watching")
  .action(async (dir: string, opts: { watch?: boolean }) => {
    const engine = engineFrom();
    try {
      const results = await engine.ingestDir(dir);
      if (results.length === 0) {
        console.log(`No supported files found under ${dir}`);
      }
      for (const r of results) {
        console.log(
          r.skipped
            ? `• ${r.title} — already ingested, skipped`
            : `✓ ${r.title} — ${r.chunks} chunks, +${r.nodesCreated} nodes, +${r.edgesCreated} edges`,
        );
      }
      if (opts.watch) {
        const w = engine.addWatchedDir(dir);
        console.log(`✓ registered ${w.dir} for auto-watch — run \`context-graph watch\` to start the daemon`);
      }
    } finally {
      await engine.close();
    }
  });

/** One log line per watcher event, mirroring the ingest commands' ✓/•/✗ style. */
function logWatchEvent(event: WatchEvent): void {
  switch (event.type) {
    case "watching":
      console.log(`watching ${event.dir} (${event.files} files to catch up on)`);
      break;
    case "queued":
      if (event.reason !== "initial") console.log(`  queued ${event.file} (${event.reason})`);
      break;
    case "ingested":
      console.log(
        event.result.skipped
          ? `• ${event.result.title} — unchanged, skipped`
          : `✓ ${event.result.title} — ${event.result.chunks} chunks, +${event.result.nodesCreated} nodes, +${event.result.edgesCreated} edges`,
      );
      break;
    case "deleted": {
      const p = event.pruned;
      const detail = p
        ? ` (pruned ${p.nodesRemoved} entities, ${p.edgesRemoved} relationships; ${p.nodesDecayed} decayed)`
        : "";
      console.log(`• ${event.file} — deleted${detail}`);
      break;
    }
    case "error":
      console.error(`✗ ${event.file}: ${event.error}`);
      break;
  }
}

program
  .command("watch")
  .description(
    "Watch folders and keep the graph evolving: new and edited docs are re-ingested automatically. " +
      "With no arguments, resumes previously registered folders. Ctrl-C to stop.",
  )
  .argument("[dirs...]", "directories to watch (registered for future runs unless --no-register)")
  .option("-e, --ext <exts...>", 'extensions to ingest (default: ".pdf" ".md" ".markdown" ".txt")')
  .option("--debounce <ms>", "quiet time after a save before re-ingesting", (v) => parseInt(v, 10), 1500)
  .option("--no-register", "don't persist the given directories to the watch registry")
  .option("--no-initial-scan", "skip the catch-up scan of existing files at startup")
  .action(
    async (
      dirs: string[],
      opts: { ext?: string[]; debounce: number; register: boolean; initialScan: boolean },
    ) => {
      const engine = engineFrom();
      if (opts.register) {
        for (const dir of dirs) engine.addWatchedDir(dir, opts.ext);
      }
      const targets = new Set(dirs.map((d) => resolve(d)));
      for (const w of engine.listWatchedDirs()) targets.add(w.dir);
      if (targets.size === 0) {
        console.error("No watched folders. Run: context-graph watch <dir>");
        await engine.close();
        process.exit(1);
      }

      const watcher = new GraphWatcher(engine, {
        extensions: opts.ext,
        debounceMs: opts.debounce,
        initialScan: opts.initialScan,
        onEvent: logWatchEvent,
      });
      // The daemon owns the engine for its lifetime — closed on signal, not
      // in a finally like the one-shot commands.
      let stopping = false;
      const stop = async () => {
        if (stopping) return;
        stopping = true;
        console.log("\nstopping…");
        await watcher.close();
        await engine.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void stop());
      process.on("SIGTERM", () => void stop());

      for (const dir of targets) await watcher.add(dir);
      await watcher.idle();
      console.log("caught up — watching for changes (Ctrl-C to stop)");
    },
  );

program
  .command("watch-status")
  .description("List folders registered for auto-watching")
  .action(async () => {
    const engine = engineFrom();
    try {
      const dirs = engine.listWatchedDirs();
      if (dirs.length === 0) {
        console.log("No watched folders. Register one with: context-graph watch <dir>");
        return;
      }
      for (const w of dirs) {
        const exts = w.extensions?.join(" ") ?? "default extensions";
        console.log(`${w.dir}  (${exts}, since ${w.addedAt.slice(0, 10)})`);
      }
    } finally {
      await engine.close();
    }
  });

program
  .command("unwatch")
  .description("Remove a folder from the auto-watch registry")
  .argument("<dir>", "directory to stop watching")
  .action(async (dir: string) => {
    const engine = engineFrom();
    try {
      console.log(
        engine.removeWatchedDir(dir)
          ? `✓ removed ${resolve(dir)} from the watch registry`
          : `• ${resolve(dir)} was not registered`,
      );
    } finally {
      await engine.close();
    }
  });

program
  .command("repo")
  .description(
    "Ingest a code repository as prose summaries (one LLM summary per file, grouped per top-level " +
      "directory). Raw code is never fed to the extractor. Incremental: only changed files are re-summarized.",
  )
  .argument("<dir>", "repository root")
  .option("-e, --extensions <exts...>", 'code extensions to include (e.g. ".ts" ".py")')
  .action(async (dir: string, opts: { extensions?: string[] }) => {
    const engine = engineFrom();
    try {
      const r = await engine.ingestRepo(dir, {
        extensions: opts.extensions,
        onProgress: ({ phase, index, total, file }) =>
          process.stderr.write(
            `\r${phase === "summarize" ? "summarizing" : "ingesting"} ${index + 1}/${total}: ${file.slice(0, 60).padEnd(60)}`,
          ),
      });
      process.stderr.write("\n");
      console.log(
        `✓ ${r.files} code files — ${r.summarized} summarized, ${r.cached} unchanged (cache hits)`,
      );
      for (const m of r.modules) {
        console.log(
          m.skipped
            ? `• ${m.title} — unchanged, skipped`
            : `✓ ${m.title} — ${m.chunks} chunks, +${m.nodesCreated} nodes, +${m.edgesCreated} edges`,
        );
      }
      for (const e of r.errors) console.error(`✗ ${e}`);
    } finally {
      await engine.close();
    }
  });

const ghExec = promisify(execFile);

/** Run a `gh` command and parse its JSON output. */
async function gh<T>(args: string[]): Promise<T> {
  try {
    const { stdout } = await ghExec("gh", args, { maxBuffer: 32_000_000 });
    return JSON.parse(stdout) as T;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === "ENOENT") {
      throw new Error("GitHub CLI (`gh`) not found. Install it from https://cli.github.com and run `gh auth login`.");
    }
    throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${e.stderr?.trim() || e.message}`);
  }
}

interface PrDetail {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  mergedAt: string | null;
  author: { login: string } | null;
  comments: Array<{ author: { login: string } | null; body: string }>;
  reviews: Array<{ author: { login: string } | null; state: string; body: string }>;
}

program
  .command("ingest-prs")
  .description("Ingest GitHub pull requests (title, description, review comments) via the gh CLI")
  .option("-R, --repo <owner/name>", "GitHub repository (default: the current directory's repo)")
  .option("-n, --limit <n>", "max PRs to ingest", (v) => parseInt(v, 10), 50)
  .option("-s, --state <state>", "open | closed | merged | all", "merged")
  .action(async (opts: { repo?: string; limit: number; state: string }) => {
    const repo =
      opts.repo ??
      (await gh<{ nameWithOwner: string }>(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner;
    const list = await gh<Array<{ number: number }>>([
      "pr", "list", "--repo", repo, "--state", opts.state,
      "--limit", String(opts.limit), "--json", "number",
    ]);
    if (list.length === 0) {
      console.log(`No ${opts.state} PRs found in ${repo}.`);
      return;
    }
    const engine = engineFrom();
    try {
      for (const { number } of list) {
        const pr = await gh<PrDetail>([
          "pr", "view", String(number), "--repo", repo,
          "--json", "number,title,body,url,state,mergedAt,author,comments,reviews",
        ]);
        const discussion = [
          ...pr.reviews
            .filter((r) => r.body?.trim())
            .map((r) => `- ${r.author?.login ?? "unknown"} (review, ${r.state}): ${r.body.trim()}`),
          ...pr.comments
            .filter((c) => c.body?.trim())
            .map((c) => `- ${c.author?.login ?? "unknown"}: ${c.body.trim()}`),
        ];
        const text = [
          `# PR #${pr.number}: ${pr.title}`,
          `Repo: ${repo}. Author: ${pr.author?.login ?? "unknown"}. State: ${pr.state}${pr.mergedAt ? ` (merged ${pr.mergedAt.slice(0, 10)})` : ""}. ${pr.url}`,
          `## Description\n\n${pr.body?.trim() || "(no description)"}`,
          ...(discussion.length ? [`## Discussion\n\n${discussion.join("\n")}`] : []),
        ].join("\n\n");
        const r = await engine.ingest(text, {
          title: `PR #${pr.number}: ${pr.title}`,
          source: `pr:${repo}#${pr.number}`,
        });
        console.log(
          r.skipped
            ? `• PR #${pr.number} — already ingested, skipped`
            : `✓ PR #${pr.number}: ${pr.title} — +${r.nodesCreated} nodes, +${r.edgesCreated} edges`,
        );
      }
    } finally {
      await engine.close();
    }
  });

/** The two hook commands install-hooks wires into Claude Code. */
const SESSION_START_CMD = "context-graph hook session-start";
const STOP_CMD = "context-graph hook stop";

program
  .command("install-hooks")
  .description("Install Claude Code hooks: inject graph context at session start, nudge a contribution at stop")
  .option("--dir <path>", "project directory (default: current directory)")
  .option("--no-stop", "skip the Stop hook (the contribution nudge)")
  .action(async (opts: { dir?: string; stop: boolean }) => {
    const projectDir = resolve(opts.dir ?? ".");
    const settingsPath = join(projectDir, ".claude", "settings.json");
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath)) {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    }
    const hooks = (settings.hooks ??= {}) as Record<
      string,
      Array<{ matcher?: string; hooks: Array<{ type: string; command: string }> }>
    >;
    const addHook = (event: string, command: string): boolean => {
      const entries = (hooks[event] ??= []);
      if (entries.some((e) => e.hooks?.some((h) => h.command === command))) return false;
      entries.push({ hooks: [{ type: "command", command }] });
      return true;
    };
    const added: string[] = [];
    if (addHook("SessionStart", SESSION_START_CMD)) added.push("SessionStart");
    if (opts.stop && addHook("Stop", STOP_CMD)) added.push("Stop");
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    console.log(
      added.length
        ? `✓ installed ${added.join(" + ")} hook${added.length > 1 ? "s" : ""} in ${settingsPath}`
        : `• hooks already installed in ${settingsPath}`,
    );
    console.log("  SessionStart injects relevant graph context; Stop nudges the agent to contribute learnings.");
  });

const hook = program
  .command("hook")
  .description("Claude Code hook entry points (installed by `install-hooks`; not usually run by hand)");

hook
  .command("session-start")
  .description("Print relevant graph context for injection at Claude Code session start")
  .action(async () => {
    // No graph yet → stay silent rather than erroring inside the hook.
    const cfg = resolveConfig({ dbPath: program.opts<{ db?: string }>().db });
    if (cfg.dbPath !== ":memory:" && !existsSync(cfg.dbPath)) return;
    const engine = engineFrom();
    try {
      const stats = await engine.stats();
      if (stats.nodes === 0) return;
      const project = basename(process.cwd());
      const bundle = await engine.read(
        `${project}: conventions, architecture decisions, gotchas, current work`,
        { maxNodes: 8, maxChunks: 4 },
      );
      if (bundle.nodes.length === 0 && bundle.chunks.length === 0) return;
      console.log("## Team context graph (auto-injected at session start)\n");
      console.log(bundle.prompt);
      console.log(
        "\nWhen you learn something durable this session (a decision, gotcha, or convention), " +
          "record it with the context_contribute MCP tool.",
      );
    } finally {
      await engine.close();
    }
  });

hook
  .command("stop")
  .description("Nudge the agent to contribute session learnings before finishing")
  .action(async () => {
    // Reads the Stop-hook JSON from stdin. `stop_hook_active` means this stop
    // was already extended by us once — let it through or we'd loop forever.
    let input: { stop_hook_active?: boolean } = {};
    try {
      input = JSON.parse(readFileSync(0, "utf8")) as { stop_hook_active?: boolean };
    } catch {
      /* no stdin — treat as a plain stop */
    }
    if (input.stop_hook_active) return;
    const cfg = resolveConfig({ dbPath: program.opts<{ db?: string }>().db });
    if (cfg.dbPath !== ":memory:" && !existsSync(cfg.dbPath)) return;
    console.log(
      JSON.stringify({
        decision: "block",
        reason:
          "Before finishing: if this session produced a durable, non-obvious learning (a decision made, " +
          "a gotcha hit, a convention discovered, a fix future agents should know about), record each one " +
          "with the context_contribute MCP tool. If nothing is worth recording, finish without contributing.",
      }),
    );
  });

program
  .command("export")
  .description("Export the whole graph for viewing (interactive HTML, JSON, or Mermaid)")
  .option("-f, --format <fmt>", "html | json | mermaid", "html")
  .option("-o, --out <path>", "output file (default: context-graph.<ext>)")
  .action(async (opts: { format: string; out?: string }) => {
    const engine = engineFrom();
    try {
      const g = await engine.exportGraph();
      let content: string;
      let ext: string;
      if (opts.format === "json") {
        content = JSON.stringify(g, null, 2);
        ext = "json";
      } else if (opts.format === "mermaid") {
        content = toMermaid(g);
        ext = "mmd";
      } else {
        content = toHtml(g);
        ext = "html";
      }
      const out = opts.out ?? `context-graph.${ext}`;
      writeFileSync(out, content);
      console.log(`✓ wrote ${g.nodes.length} entities / ${g.edges.length} relationships to ${out}`);
      if (ext === "html") console.log(`  open it:  open ${out}`);
    } finally {
      await engine.close();
    }
  });

program
  .command("stats")
  .description("Show graph statistics")
  .action(async () => {
    const engine = engineFrom();
    try {
      const s = await engine.stats();
      console.log(`documents: ${s.documents}\nnodes:     ${s.nodes}\nedges:     ${s.edges}\nchunks:    ${s.chunks}`);
    } finally {
      await engine.close();
    }
  });

/** Resolve the graph-file path for team sync (flag overrides the default). */
function syncFilePath(engine: ContextGraphEngine, flag?: string): string {
  const file = flag ?? engine.graphFilePath;
  if (!file) {
    throw new Error(
      "No graph file path — an in-memory graph can't be synced. Pass --file <path> or use a file-backed --db.",
    );
  }
  return file;
}

program
  .command("push")
  .description("Team sync (git mode): write the graph to a committable JSONL file")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      writeFileSync(file, await engine.exportJsonl());
      const s = await engine.stats();
      console.log(`✓ wrote ${s.nodes} entities / ${s.edges} relationships to ${file}`);
      console.log(`  commit it:  git add ${file} && git commit -m "update context graph"`);
    } finally {
      await engine.close();
    }
  });

program
  .command("pull")
  .description("Team sync (git mode): import + re-merge a teammate's JSONL file")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      if (!existsSync(file)) {
        console.log(`No graph file at ${file} yet — nothing to pull.`);
        return;
      }
      const r = await engine.importJsonl(readFileSync(file, "utf8"));
      for (const w of r.warnings) console.warn(`⚠ ${w}`);
      console.log(
        `✓ merged ${file} — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), ` +
          `+${r.edgesCreated} edges (${r.edgesUpdated} reinforced), ` +
          `+${r.documentsAdded} docs, +${r.chunksAdded} sources`,
      );
    } finally {
      await engine.close();
    }
  });

program
  .command("sync")
  .description("Team sync (git mode): pull a teammate's JSONL, re-merge, then push the merged graph")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      if (existsSync(file)) {
        const r = await engine.importJsonl(readFileSync(file, "utf8"));
        for (const w of r.warnings) console.warn(`⚠ ${w}`);
        console.log(
          `↓ merged in — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), ` +
            `+${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
        );
      }
      writeFileSync(file, await engine.exportJsonl());
      const s = await engine.stats();
      console.log(`↑ wrote merged graph (${s.nodes} entities / ${s.edges} relationships) to ${file}`);
      console.log(`  commit it:  git add ${file} && git commit -m "sync context graph"`);
    } finally {
      await engine.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
