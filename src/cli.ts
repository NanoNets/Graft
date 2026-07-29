#!/usr/bin/env node
/**
 * `graft` CLI. Commands: build, ask, check, viz, mcp, callers, skeleton, grep,
 * map, init. Git is the sync: commit graft/ and a clone has the graph. A
 * workspace parent (≥2 git children) federates query commands across children.
 */
import "dotenv/config";
import { Command } from "commander";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Graft } from "./engine.js";
import { resolveConfig, type EngineConfig } from "./ai/providers.js";
import type { ProviderKind } from "./ai/llm/factory.js";
import { formatCheckReport } from "./context/check.js";
import { formatGraphCheckReport } from "./graph/check.js";
import { buildGraphIfMissing, runInit } from "./claude/init.js";
import { runHostsInit } from "./hosts/init.js";
import { hostIds } from "./hosts/registry.js";
import { contextDirFor } from "./context/node-file.js";
import { loadGraphCached } from "./graph/load.js";
import { ensureFreshChildren, ensureFreshGraph, refreshNote } from "./graph/refresh.js";
import { isWorkspaceBuildRoot, readWorkspace } from "./graph/workspace.js";
import {
  runWorkspaceAsk,
  runWorkspaceBuild,
  runWorkspaceCallers,
  runWorkspaceCheck,
  runWorkspaceGrep,
  runWorkspaceMap,
} from "./graph/workspace-cli.js";
import { formatInitEpilogue } from "./cli-epilogue.js";
import { planInit, selectedWrites } from "./hosts/plan.js";
import { formatNonInteractiveHelp, formatPlan, runPicker } from "./cli-picker.js";
import { homedir } from "node:os";
import { formatUpgradeReport, formatVersionReport, getNpmViewVersion, readCurrentVersion, runUpgrade } from "./cli-meta.js";

const program = new Command();
const currentVersion = readCurrentVersion(import.meta.url);

program
  .name("graft")
  .description("Build a repo's context graph as linked markdown, and keep it in sync with the code.")
  .version(currentVersion, "-v, --version")
  .option("--dir <path>", "context graph directory (default: <repo>/graft)")
  .option("--provider <name>", "LLM wire format: openai | anthropic (env GRAFT_PROVIDER)")
  .option("--model <id>", "model id for the LLM pass (env GRAFT_MODEL)")
  .option("--api-key <key>", "provider API key (env GRAFT_API_KEY)")
  .option("--base-url <url>", "OpenAI-compatible endpoint URL (env GRAFT_BASE_URL)");

interface GlobalOpts {
  dir?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/** Config drawn from the global CLI flags (env + defaults fill the rest). */
function cliConfig(): EngineConfig {
  const o = program.opts<GlobalOpts>();
  return {
    contextDir: o.dir,
    provider: o.provider as ProviderKind | undefined,
    model: o.model,
    apiKey: o.apiKey,
    baseUrl: o.baseUrl,
  };
}

const engineFrom = (): Graft => new Graft(cliConfig());

/**
 * Bring the graph up to date with the working tree before a query answers from it
 * — the same gate the MCP tools run (see `graph/refresh.ts`). Cheap when nothing
 * moved; a structural, $0 rebuild when it did. The note goes to stderr so `--json`
 * stdout stays machine-readable.
 */
async function refreshBefore(dir: string, opts: { refresh?: boolean }): Promise<void> {
  const globalDir = program.opts<GlobalOpts>().dir;
  const root = resolve(dir);
  const disabled = opts.refresh === false;
  const ws = readWorkspace(root, globalDir);
  const r = ws
    ? await ensureFreshChildren(root, ws.children, { contextDir: globalDir, disabled })
    : await ensureFreshGraph(root, { contextDir: globalDir, disabled });
  const note = refreshNote(r);
  if (note) console.error(note);
}

/** Attached to every query command: `--no-refresh` answers from the graph exactly
 * as it is on disk, no rebuild. */
const NO_REFRESH_FLAG = ["--no-refresh", "skip the freshness check — answer from the graph as-is"] as const;

program
  .command("version")
  .description("Print the installed version and the latest published on npm")
  .action(() => {
    const latest = getNpmViewVersion();
    console.log(formatVersionReport(currentVersion, latest));
  });

program
  .command("upgrade")
  .description("Upgrade the globally installed graft to the latest version on npm")
  .action(() => {
    const result = runUpgrade(import.meta.url);
    console.log(formatUpgradeReport(result));
    if (result.ran && !result.ok) process.exit(1);
  });

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
  .option("--no-reuse", "re-parse every file instead of replaying unchanged ones from the extraction cache")
  .action(async (dir: string, opts: { deep?: boolean; extensions?: string[]; concurrency?: string; reuse?: boolean }) => {
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

    // --deep needs a key; without one, degrade to the $0 structural build.
    let deep = opts.deep;
    const resolved = resolveConfig(cliConfig());
    if (deep && !resolved.apiKey) {
      deep = false;
      console.error(
        "⚠ no API key set — falling back to the structural build (no LLM summaries).\n" +
          "  Set GRAFT_API_KEY (and GRAFT_PROVIDER / GRAFT_BASE_URL / GRAFT_MODEL for your\n" +
          "  provider) and re-run `graft build --deep` to add concept nodes and summaries.",
      );
    }
    if (deep && resolved.usedLegacyEnv) {
      console.error(
        "⚠ using OPENROUTER_API_KEY (deprecated) — prefer GRAFT_API_KEY + GRAFT_BASE_URL.",
      );
    }

    // Workspace parent: build each child into its OWN graft/ + a workspace index.
    const buildRoot = resolve(dir);
    const buildGlobalDir = program.opts<GlobalOpts>().dir;
    if (isWorkspaceBuildRoot(buildRoot, buildGlobalDir)) {
      await runWorkspaceBuild(buildRoot, {
        deep: !!deep,
        extensions: opts.extensions,
        concurrency,
        childConfig: cliConfig(),
        override: buildGlobalDir,
      });
      return;
    }

    // --deep: concept nodes first, then the wiring graph links cards up to them.
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

    // Wiring graph — always; LLM meaning only with --deep.
    const g = await engine.graph(dir, {
      llm: deep,
      concurrency,
      reuse: opts.reuse,
      onProgress: ({ phase, index, total, file }) =>
        process.stderr.write(
          `\r${phase === "enrich" ? "summarizing" : "parsing"} ${index + 1}/${total}: ${file.slice(0, 50).padEnd(50)}`,
        ),
    });
    process.stderr.write("\n");
    console.log(`✓ wiring: ${g.nodes} nodes (${fmt(g.byKind)}), ${g.edges} edges, ${g.cards} cards [${g.languages.join(", ")}]`);
    console.log(`  parsed: ${g.parsed} of ${g.files} files (${g.reused} replayed from cache)`);
    if (deep) {
      const m = g.meaning;
      console.log(`  meaning: ${m.computed} computed, ${m.cached} cached, ${m.stale} stale, ${m.pending} pending`);
    }
    console.log(`  → ${g.contextDir}`);
    for (const e of g.errors) console.error(`✗ ${e}`);

    const rel = relative(process.cwd(), g.contextDir) || "graft";
    console.log(`  ${rel}/ is git-ignored (added automatically) — a local cache; teammates run \`graft build\` to get their own.`);
  });

program
  .command("ask")
  .description("Query the graft/ graph — returns ranked nodes + exact file:line, routed to prose or wiring ($0, no key)")
  .argument("<query>", "what you want to understand, in plain words")
  .argument("[dir]", "repository root", ".")
  .option("-n, --limit <n>", "max results", "8")
  .option("--source", "inline the source at each file:line hit (retriever mode — the pack IS the answer, no need to re-open files)")
  .option("--full", "with --source: inline whole definition spans instead of the default ≤8-line crux excerpts")
  .option("--in <path>", "narrow to nodes under this path prefix, filtered before scoring (segment-aware, like scopeOf)")
  .option("--json", "output the result as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(async (query: string, dir: string, opts: { limit: string; source?: boolean; full?: boolean; in?: string; json?: boolean; refresh?: boolean }) => {
    await refreshBefore(dir, opts);
    const askGlobalDir = program.opts<GlobalOpts>().dir;
    if (readWorkspace(resolve(dir), askGlobalDir)) {
      runWorkspaceAsk(resolve(dir), askGlobalDir, query, {
        limit: Number(opts.limit), source: opts.source, full: opts.full, in: opts.in, json: opts.json,
      });
      return;
    }
    const engine = engineFrom();
    let r;
    try {
      r = engine.ask(dir, query, { limit: Number(opts.limit), source: opts.source, full: opts.full, in: opts.in });
    } catch (err) {
      console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
      return;
    }
    if (opts.json) {
      console.log(JSON.stringify(r, null, 2));
    } else {
      const { formatAsk } = await import("./ask/ask.js");
      process.stdout.write(formatAsk(r));
    }
  });

program
  .command("skeleton")
  .description("Signatures-only view of one file from the wiring graph — the cheapest way to see a file's API surface")
  .argument("<file>", "repo-relative path (or unique basename) of the file")
  .argument("[dir]", "repository root", ".")
  .option("--json", "output the result as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(async (file: string, dir: string, opts: { json?: boolean; refresh?: boolean }) => {
    await refreshBefore(dir, opts);
    const { skeleton, formatSkeleton } = await import("./ask/ask.js");
    const globalOpts = program.opts<{ dir?: string }>();
    const r = skeleton(dir, file, { contextDir: globalOpts.dir });
    if (opts.json) console.log(JSON.stringify(r, null, 2));
    else process.stdout.write(formatSkeleton(r));
  });

program
  .command("check")
  .description("Fail if graft/ is stale relative to the code (for CI)")
  .argument("[dir]", "repository root", ".")
  .option("-e, --extensions <exts...>", "code extensions to include")
  .option("--json", "output the drift as JSON")
  .action((dir: string, opts: { extensions?: string[]; json?: boolean }) => {
    const checkGlobalDir = program.opts<GlobalOpts>().dir;
    if (readWorkspace(resolve(dir), checkGlobalDir)) {
      runWorkspaceCheck(resolve(dir), checkGlobalDir);
      return;
    }
    const engine = engineFrom();
    const r = engine.check(dir, { extensions: opts.extensions });
    const g = engine.checkGraph(dir); // graph.json is only judged when it exists

    // A layer that IS present must be in sync; a never-built layer (keyless
    // build skips the markdown layer) is informational, not a failure.
    const bothMissing = r.missing && g.missing;
    const markdownFail = !r.missing && !r.ok;
    const wiringFail = !g.missing && !g.ok;

    if (opts.json) {
      console.log(JSON.stringify({ context: r, graph: g.missing ? null : g }, null, 2));
    } else if (bothMissing) {
      console.log("graft check: NO GRAPH\n\nNo graft/ graph found. Run `graft build` first.");
    } else {
      if (r.missing) {
        console.log(
          "deep layer: not built (run `graft build --deep` for concept nodes) — wiring graph is the source of truth",
        );
      } else {
        console.log(formatCheckReport(r));
      }
      if (!g.missing) console.log("\n" + formatGraphCheckReport(g));
    }

    if (bothMissing || markdownFail || wiringFail) process.exit(1);
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
    const viewerDir = fileURLToPath(new URL("./viewer/", import.meta.url)); // prebuilt
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
  .command("mcp")
  .description("Serve the graph over MCP (stdio) — exposes graft_find_code, graft_trace_calls, graft_find_all, graft_file_api, graft_repo_map and graft_check_freshness as tools")
  .argument("[dir]", "repository root", ".")
  .action(async (dir: string) => {
    const { resolve } = await import("node:path");
    const { startMcpServer } = await import("./mcp/server.js");
    const globalOpts = program.opts<{ dir?: string }>();
    startMcpServer(resolve(dir), globalOpts.dir, currentVersion);
  });

program
  .command("callers")
  .description(
    "Who calls/references a symbol ($0, no LLM). --direction out gives callees (what it calls); --depth N (or all) walks transitively for full blast radius",
  )
  .argument("<symbol>", "bare name, qualified (Class.method), or package-qualified (pkg.Fn)")
  .argument("[dir]", "repository root", ".")
  .option("--direction <in|out>", 'edge direction: "in" = callers (default), "out" = callees')
  .option("-d, --depth <n>", 'walk transitively up to N hops for blast radius, or "all" for the full connected closure (default 1)')
  .option("--in <path>", "narrow matches to nodes whose path contains this substring")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(
    async (
      symbol: string,
      dir: string,
      opts: { direction?: string; depth?: string; in?: string; json?: boolean; refresh?: boolean },
    ) => {
      await refreshBefore(dir, opts);
      const globalOpts = program.opts<{ dir?: string }>();
      if (!opts.json && readWorkspace(resolve(dir), globalOpts.dir)) {
        runWorkspaceCallers(resolve(dir), globalOpts.dir, symbol, {
          direction: opts.direction === "out" ? "out" : "in",
          depth: opts.depth
            ? (/^(all|full|max)$/i.test(opts.depth) ? Number.POSITIVE_INFINITY : Number(opts.depth))
            : undefined,
          in: opts.in,
        });
        return;
      }
      const { runCallersCommand } = await import("./graph/traverse-cli.js");
      runCallersCommand(symbol, dir, {
        direction: opts.direction,
        depth: opts.depth,
        in: opts.in,
        json: opts.json,
        globalDir: globalOpts.dir,
      });
    },
  );

program
  .command("grep")
  .description("Regex search over indexed files, hits grouped by enclosing symbol and ranked by coupling ($0, no LLM)")
  .argument("<pattern>", "regex pattern (or literal string with --fixed)")
  .argument("[dir]", "repository root", ".")
  .option("-i, --ignore-case", "case-insensitive match")
  .option("--fixed", "treat pattern as a literal string, not a regex")
  .option("--in <path>", "narrow to files whose path contains this substring")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(
    async (
      pattern: string,
      dir: string,
      opts: { ignoreCase?: boolean; fixed?: boolean; in?: string; json?: boolean; refresh?: boolean },
    ) => {
      await refreshBefore(dir, opts);
      const globalOpts = program.opts<{ dir?: string }>();
      if (readWorkspace(resolve(dir), globalOpts.dir)) {
        runWorkspaceGrep(resolve(dir), globalOpts.dir, pattern, {
          ignoreCase: opts.ignoreCase, fixed: opts.fixed, json: opts.json,
        });
        return;
      }
      const { runGrepCommand } = await import("./search/grep-cli.js");
      runGrepCommand(pattern, dir, {
        ignoreCase: opts.ignoreCase,
        fixed: opts.fixed,
        in: opts.in,
        json: opts.json,
        globalDir: globalOpts.dir,
      });
    },
  );

program
  .command("map")
  .description(
    "Token-budgeted repo orientation — directory clusters, per-directory hubs, and global hotspots from the wiring graph ($0, no LLM)",
  )
  .argument("[dir]", "repository root", ".")
  .option("--max-dirs <n>", "max directory entries shown, rest counted into dropped (default 16)")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(async (dir: string, opts: { json?: boolean; maxDirs?: string; refresh?: boolean }) => {
    const root = resolve(dir);
    const globalOpts = program.opts<{ dir?: string }>();
    let maxDirsW: number | undefined;
    if (opts.maxDirs !== undefined) {
      const n = parseInt(opts.maxDirs, 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`✗ --max-dirs must be a positive integer, got "${opts.maxDirs}"`);
        process.exit(1);
        return;
      }
      maxDirsW = n;
    }
    await refreshBefore(dir, opts); // after arg validation: a bad flag shouldn't cost a rebuild
    if (!opts.json && readWorkspace(root, globalOpts.dir)) {
      runWorkspaceMap(root, globalOpts.dir, { maxDirs: maxDirsW });
      return;
    }
    const { buildRepoMap, formatRepoMap } = await import("./graph/map.js");
    const contextDir = contextDirFor(root, globalOpts.dir);
    const graph = loadGraphCached(contextDir);
    if (!graph) {
      console.error("✗ no graph — run graft build first");
      process.exit(1);
      return;
    }
    const map = buildRepoMap(graph, { maxDirs: maxDirsW });
    if (opts.json) {
      console.log(JSON.stringify(map, null, 2));
      return;
    }
    process.stdout.write(formatRepoMap(map));
  });

program
  .command("init")
  .description("Wire Graft into the AI coding agents used with this repo (instruction files + MCP server; full hooks + statusline + MCP for Claude Code)")
  .argument("[dir]", "target repo directory", ".")
  .option("--no-build", "skip building the graph (wire files only)")
  .option("--agents <ids...>", `only these agents (${hostIds().join(", ")}, claude)`)
  .option("--all-agents", "write instruction files for every known agent, detected or not")
  .option("--no-agents", "Claude Code wiring only; skip other agents")
  .option("--list-agents", "list known agent ids and exit")
  .option("--no-mcp", "skip MCP server registration for other agents")
  .option("--no-hooks", "skip hook installation for other agents")
  .option("--dry-run", "print every file init would touch, then exit without writing")
  .option("-y, --yes", "skip the picker and wire every detected agent (the pre-0.8 default)")
  .option("--no-global", "skip writes outside this repo (the ~/.codex/ config + hooks)")
  .action(async (dir: string, opts: { build?: boolean; agents?: string[]; allAgents?: boolean; listAgents?: boolean; mcp?: boolean; hooks?: boolean; dryRun?: boolean; yes?: boolean; global?: boolean }) => {
    if (opts.listAgents) {
      for (const id of [...hostIds(), "claude"]) console.log(id);
      return;
    }
    const repo = resolve(dir);
    const explicit = Array.isArray(opts.agents) ? opts.agents : undefined;

    if (explicit) {
      const validIds = [...hostIds(), "claude"];
      const unknown = explicit.filter((id) => !validIds.includes(id));
      if (unknown.length) {
        console.error(`✗ unknown agent id(s): ${unknown.join(", ")} — valid: ${validIds.join(", ")}`);
        process.exit(1);
      }
    }

    // Which agents to wire, decided before anything is written. Explicit flags
    // win; otherwise prompt on a TTY, and on a pipe write nothing rather than
    // guessing (pre-0.8 this silently wired every agent the machine had ever
    // installed — see --yes to get that back).
    const home = homedir();
    const plan = planInit(repo, { home });
    const detectedIds = plan.filter((p) => p.detected).map((p) => p.id);
    const noAgents = (opts as { agents?: unknown }).agents === false;

    let ids: string[];
    if (explicit) ids = explicit;
    else if (opts.allAgents) ids = plan.map((p) => p.id);
    else if (noAgents) ids = ["claude"];
    else if (opts.yes || opts.dryRun) ids = detectedIds;
    else if (process.stdin.isTTY && process.stderr.isTTY) {
      const picked = await runPicker(plan, repo, home);
      if (picked === null) {
        console.error("· cancelled — nothing written");
        return;
      }
      ids = picked;
    } else {
      console.error(formatNonInteractiveHelp(detectedIds));
      return;
    }

    if (opts.dryRun) {
      console.error(formatPlan(plan, ids, repo, home));
      return;
    }
    if (ids.length === 0) {
      console.error("· no agents selected — nothing written");
      return;
    }

    const wantClaude = ids.includes("claude");
    const cliPath = fileURLToPath(import.meta.url);

    if (wantClaude) {
      const res = runInit(repo, { build: opts.build, cliPath });
      console.error(`✓ wrote ${res.settingsPath}`);
      for (const s of res.shims) console.error(`✓ wrote ${s}`);
      console.error(`✓ wrote ${res.skill}`);
      if (res.mcp.action === "skipped-unparseable")
        console.error(`⚠ .mcp.json: ${res.mcp.path} left unchanged (not valid JSON) — add the graft server manually`);
      else if (res.mcp.action === "unchanged")
        console.error(`· mcp claude: ${res.mcp.path} (already registered)`);
      else
        console.error(`✓ mcp claude: ${res.mcp.path} (${res.mcp.action}) — restart Claude Code to load the graft MCP server`);
      console.error(res.built ? "✓ built the graph (graft build)" : "· skipped graph build");
      for (const w of res.warnings) console.error(`⚠ ${w}`);
    }

    // `ids` is already resolved, so hosts init is always driven by an explicit
    // list — never by its own detection fallback.
    const others = ids.filter((id) => id !== "claude");
    if (others.length > 0) {
      const r = runHostsInit(repo, {
        agents: others,
        home,
        mcp: opts.mcp,
        hooks: opts.hooks,
        global: opts.global,
      });
      for (const w of r.written) console.error(`✓ ${w.id}: ${w.path} (${w.action})`);
      for (const m of r.mcp) console.error(`✓ mcp ${m.id}: ${m.path} (${m.action})`);
      for (const h of r.hooks) console.error(`✓ hook ${h.id}: ${h.path} (${h.action})`);
      // Only worth saying when there was actually something out-of-repo to skip.
      if (opts.global === false && selectedWrites(plan, ids).some((w) => w.scope === "global"))
        console.error("· skipped out-of-repo writes (--no-global)");
    }

    // Every host's wiring points at graft/, so the graph is built whatever was
    // selected — not only when Claude Code is in the list (runInit does its own).
    if (!wantClaude) {
      console.error(
        buildGraphIfMissing(repo, { build: opts.build, cliPath })
          ? "✓ built the graph (graft build)"
          : "· skipped graph build",
      );
    }

    const globalOpts = program.opts<{ dir?: string }>();
    const outDir = contextDirFor(repo, globalOpts.dir);
    const graph = loadGraphCached(outDir);
    console.error(
      "\n" +
        formatInitEpilogue({
          graphBuilt: graph !== null,
          nodes: graph?.meta.nodeCount,
          edges: graph?.meta.edgeCount,
        }),
    );
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
