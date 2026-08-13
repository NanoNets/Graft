#!/usr/bin/env node
/**
 * `graft` CLI. Commands: build, ask, check, viz, mcp, callers, skeleton, grep,
 * map, init. Git is the sync: commit graft/ and a clone has the graph. A
 * workspace parent (≥2 git children) federates query commands across children.
 */
import "dotenv/config";
import { Command, InvalidArgumentError } from "commander";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODE_EXTENSIONS, Graft } from "./engine.js";
import { credentialProblem, resolveConfig, type EngineConfig } from "./ai/providers.js";
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
import { nearestGraftRoot } from "./graph/root.js";
import { supportedExtensions } from "./graph/source-files.js";
import { discoverWorkspaceChildren } from "./graph/scopes.js";
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
import { assertRepoDir } from "./ingest/fs.js";
import { readExtensions, readIncludeDirs, writeBuildConfig } from "./util/state.js";
import { formatCount } from "./util/num.js";
import { formatUpdateNudge, maybeRefreshInBackground, readUpdateCache, refreshUpdateCache, writeStamp } from "./upkeep.js";

const program = new Command();
const currentVersion = readCurrentVersion(import.meta.url);

program
  .name("graft")
  .description("Build a repo's context graph as linked markdown, and keep it in sync with the code.")
  .version(currentVersion, "-v, --version")
  .option("--dir <path>", "context graph directory (default: <repo>/graft)")
  .option(
    "--provider <name>",
    "LLM wire format: openai | anthropic | claude-cli (env GRAFT_PROVIDER). " +
      "claude-cli drives your signed-in Claude Code CLI — a subscription, no API key",
  )
  .option("--model <id>", "model id for the LLM pass (env GRAFT_MODEL)")
  .option("--api-key <key>", "provider API key (env GRAFT_API_KEY); not used by claude-cli")
  .option("--base-url <url>", "OpenAI-compatible endpoint URL (env GRAFT_BASE_URL)")
  .option(
    "--max-budget-usd <usd>",
    "claude-cli only: per-call spend ceiling in USD, passed to the CLI as --max-budget-usd " +
      "(env GRAFT_CLAUDE_MAX_BUDGET_USD). Notional on a subscription — a runaway-loop valve, not a bill",
    budgetUsd,
  );

interface GlobalOpts {
  dir?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxBudgetUsd?: number;
}

/**
 * `--max-budget-usd`, rejected AT THE FLAG rather than deep inside the provider.
 *
 * The value is spent per call, on a `--deep` run that makes one call per file, so
 * the two ways to get it wrong are the two that matter: a non-number becomes `NaN`
 * and silently disables the ceiling the user asked for, and `0` reads as "no
 * budget" to the Claude CLI rather than "spend nothing". Both would surface as an
 * unexplained bill or an unexplained failure, hours in.
 */
function budgetUsd(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new InvalidArgumentError(`expected a positive number of dollars, got "${value}"`);
  }
  return n;
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
    // The env var (GRAFT_CLAUDE_MAX_BUDGET_USD) was the only way to set this, which
    // is the wrong shape for a per-run safety valve: it is decided per invocation,
    // like -j, not per machine.
    maxBudgetUsd: o.maxBudgetUsd,
  };
}

const engineFrom = (): Graft => new Graft(cliConfig());

/**
 * Warn (never fail) when a user's `-e` extension will not be read, so it is never a
 * silent no-op — `graft build -e ".vue"` used to accept it, index nothing, and exit 0.
 *
 * Two lists, because `-e` now narrows two layers that do not claim the same
 * extensions: the wiring graph filters on `supportedExtensions()` (both parser
 * tiers), the `--deep` concept pass on `CODE_EXTENSIONS` (`context/build.ts`).
 * `.vue` is in neither — that build indexes nothing at all and is the loud case.
 * `.zig` is in the first only — the wiring graph indexes it and the concept pass
 * silently sees zero files, which is the quiet case this exists for: an extension
 * used to be checked against one list and filtered by the other, so `graft build
 * --deep -e ".zig"` passed validation and then produced no concepts, saying nothing.
 */
function warnUnsupportedExtensions(exts?: string[]): void {
  if (!exts?.length) return;
  const norm = exts.map((e) => (e.trim().startsWith(".") ? e.trim() : `.${e.trim()}`).toLowerCase());
  const indexed = new Set(supportedExtensions());
  const read = new Set(CODE_EXTENSIONS);
  const noParser = norm.filter((e) => !indexed.has(e));
  const deepOnly = norm.filter((e) => indexed.has(e) && !read.has(e));
  for (const e of noParser) {
    console.error(`⚠ -e "${e}": graft has no parser for this extension — nothing will be indexed for it.`);
  }
  for (const e of deepOnly) {
    console.error(`⚠ -e "${e}": indexed in the wiring graph, but the --deep concept pass doesn't read it.`);
  }
  if (noParser.length) console.error(`  graft indexes: ${supportedExtensions().join(" ")}`);
  if (deepOnly.length) console.error(`  the --deep pass reads: ${CODE_EXTENSIONS.join(" ")}`);
}

/** Text for the omitted-`[dir]` case, shared by every query command's help. */
const DIR_ARG = ["[dir]", "repository root (default: nearest ancestor with a graft/ index)"] as const;

/**
 * The root a query runs against: the dir the user named, else the nearest
 * ancestor holding a graft index (`graph/root.ts`) so a shell or agent session
 * in a subdirectory still finds the graph. The walk is announced on stderr —
 * answering from an ancestor's graph must never be silent.
 */
function queryRoot(dir?: string): string {
  if (dir !== undefined) return resolve(dir);
  const { root, levels } = nearestGraftRoot(process.cwd(), program.opts<GlobalOpts>().dir);
  if (levels > 0) console.error(`[graft] no graft/ here — answering from ${root}/graft`);
  return root;
}

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

/**
 * Commands that own the upgrade story themselves (`version`, `upgrade`) or must
 * not editorialize on stderr at startup (`mcp` runs its own upkeep at boot, and
 * `_update-check` IS the fetch).
 */
const UPKEEP_SKIP = new Set(["version", "upgrade", "_update-check", "mcp"]);

/**
 * Every other command: top up the cached registry answer in the background and,
 * if a newer graft is out, say so once on stderr. This is what makes the CLI the
 * cache filler for the hooks, which are not allowed to touch the network.
 */
program.hook("preAction", (_parent, action) => {
  if (UPKEEP_SKIP.has(action.name())) return;
  maybeRefreshInBackground();
  const nudge = formatUpdateNudge(currentVersion, readUpdateCache()?.latest);
  if (nudge) console.error(nudge);
});

// Hidden from --help: only ever spawned detached by maybeRefreshInBackground.
program
  .command("_update-check", { hidden: true })
  .description("internal: refresh the cached latest-version answer")
  .action(() => {
    refreshUpdateCache();
  });

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
  .option("--force", "install @latest even when it is OLDER than this build (a fork, an rc, a linked checkout)")
  .action((opts: { force?: boolean }) => {
    const result = runUpgrade(import.meta.url, { force: opts.force });
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
  .option(
    "-e, --extensions <exts...>",
    'index only these code extensions (e.g. ".ts" ".py") — narrows both the wiring graph and the --deep concept pass; ' +
      "persisted, so later builds, `graft check` and the hooks/refresh path narrow identically without the flag",
  )
  .option("--no-extensions", "forget the persisted -e narrowing and go back to indexing every supported extension")
  .option("-j, --concurrency <n>", "files summarized in parallel during --deep (default 5)")
  .option("--no-reuse", "re-parse every file instead of replaying unchanged ones from the extraction cache")
  .option("--lsp", "add compiler-grade call edges via a language server if one is installed (opt-in, slower; e.g. rust-analyzer, clangd)")
  .option(
    "--include-dir <name>",
    "override SKIP_DIRS for this repo's walks — repeatable (e.g. --include-dir build --include-dir tools); " +
      "persisted, so a later build (and the hooks/refresh path) include it without the flag; dot-dirs are never overridable",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .option("--no-include-dir", "forget the persisted --include-dir override and go back to skipping every SKIP_DIRS name")
  .action(async (dir: string, opts: { deep?: boolean; extensions?: string[] | false; concurrency?: string; reuse?: boolean; lsp?: boolean; includeDir?: string[] | false }) => {
    const concurrency = opts.concurrency ? Math.max(1, Number(opts.concurrency)) : undefined;
    if (opts.concurrency && !Number.isFinite(concurrency)) {
      console.error(`✗ --concurrency must be a number, got "${opts.concurrency}"`);
      process.exit(1);
    }
    // `false` is `--no-extensions` (clear the override), never a list to apply.
    const exts = Array.isArray(opts.extensions) ? opts.extensions : undefined;
    warnUnsupportedExtensions(exts);
    // Persisted BEFORE the build itself runs, so this invocation's walks (and
    // every later no-flag build / hooks refresh) see it identically — the
    // walkDir call sites read it from state, not from a threaded option.
    const buildDir = resolve(dir);
    // …which is why the argument has to be checked HERE and not left to the walk:
    // the persist below mkdir's recursively, so `graft build ./typo --include-dir x`
    // created ./typo/.graft/config.json and only then reported that ./typo does not
    // exist. Same wording as the walk's own check — one message, two entry points.
    assertRepoDir(buildDir);
    if (opts.includeDir === false) {
      // The way back out. The override governs every future build in this repo and
      // every hooks-driven refresh, but no invocation could ever write the empty
      // list (the branch below is guarded on a non-empty one), so the only way to
      // undo it was to hand-edit a `.graft/config.json` nothing had told the user
      // existed. `--no-include-dir` is that command.
      writeBuildConfig(buildDir, { includeDirs: [] });
      console.error("· cleared this repo's persisted --include-dir override");
    } else if (opts.includeDir && opts.includeDir.length > 0) {
      // --include-dir takes bare SKIP_DIRS-style directory NAMES (shouldSkipDir
      // compares a single path segment), never paths, and dot-dirs are never
      // overridable at all (see the option's own help text) — reject anything
      // else up front instead of silently persisting a value that can never
      // match a real directory name.
      for (const name of opts.includeDir) {
        // An empty name passed both checks below and persisted `[""]`, which no
        // path segment can equal: inert junk, in a file with no reader.
        if (name.trim() === "") {
          console.error("✗ --include-dir: expected a directory name, got an empty string");
          process.exit(1);
        }
        if (name.startsWith(".")) {
          console.error(`✗ --include-dir "${name}": dot-directories are never overridable`);
          process.exit(1);
        }
        if (name.includes("/") || name.includes("\\")) {
          console.error(`✗ --include-dir "${name}": expected a bare directory name, not a path`);
          process.exit(1);
        }
      }
      writeBuildConfig(buildDir, { includeDirs: opts.includeDir });
    }
    // `-e` is persisted for the same reason and one sharper: the freshness probe and
    // the pre-query refresh never see a flag, so an unpersisted narrowing was undone
    // by the first `graft ask` (every excluded file read as new → a wide rebuild).
    if (opts.extensions === false) {
      writeBuildConfig(buildDir, { extensions: [] });
      console.error("· cleared this repo's persisted -e narrowing");
    } else if (exts && exts.length > 0) {
      writeBuildConfig(buildDir, { extensions: exts });
    }
    // Announced on every build, not only the one that set it: a persisted override
    // changes what the whole repo indexes, survives indefinitely, and is otherwise
    // completely invisible — the flag that wrote it may have been typed months ago
    // by someone else.
    const persistedDirs = readIncludeDirs(buildDir);
    if (persistedDirs) {
      console.error(
        `· --include-dir override active: ${[...persistedDirs].join(", ")} ` +
          "(clear it with `graft build --no-include-dir`)",
      );
    }
    // Read back rather than reused from the flag: this is the value every layer of
    // THIS build must agree on, whether it was typed now or months ago.
    const persistedExts = readExtensions(buildDir);
    if (persistedExts) {
      console.error(
        `· -e narrowing active: only ${persistedExts.join(" ")} is indexed ` +
          "(clear it with `graft build --no-extensions`)",
      );
    }
    const engine = engineFrom();
    const fmt = (o: Record<string, number>) =>
      Object.entries(o)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");

    // --deep needs a reachable model; without one, degrade to the $0 structural build.
    let deep = opts.deep;
    const resolved = resolveConfig(cliConfig());
    const problem = deep ? credentialProblem(resolved) : undefined;
    if (problem) {
      deep = false;
      console.error(`⚠ falling back to the structural build (no LLM summaries).\n  ${problem}`);
    }
    // Say so out loud: the run costs subscription usage, not API credits, and the
    // user never asked for this provider — they just had the CLI installed.
    if (deep && resolved.autoDetectedProvider) {
      console.error(
        `→ no API key found; using your signed-in Claude Code CLI (${resolved.model}).\n` +
          "  Set GRAFT_API_KEY to use a metered provider instead.",
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
        // The flag as typed, not the parent's persisted value: a workspace parent
        // holds no sources of its own, so the narrowing belongs in each CHILD's
        // state (where its own later rebuilds and refreshes will read it), exactly
        // as `--include-dir` is forwarded below.
        extensions: exts,
        concurrency,
        childConfig: cliConfig(),
        override: buildGlobalDir,
        // `false` is `--no-include-dir`, already applied to this repo's config
        // above; there is nothing left to forward to the children.
        includeDirs: opts.includeDir || undefined,
      });
      return;
    }

    // Everything either phase reported as `✗`. Collected rather than counted on
    // the spot because the concept pass lives in a branch and the exit code has to
    // account for both.
    const failures: string[] = [];

    // --deep: concept nodes first, then the wiring graph links cards up to them.
    if (deep) {
      const c = await engine.init(dir, {
        extensions: persistedExts,
        // The concept pass is where a --deep build spends most of its calls, so
        // `-j 1` that stopped at the wiring graph's Tier-2 pass fixed nothing for
        // the user who set it to survive a rate limit.
        concurrency,
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
      failures.push(...c.errors);
    }

    // Wiring graph — always; LLM meaning only with --deep.
    const g = await engine.graph(dir, {
      llm: deep,
      extensions: persistedExts,
      concurrency,
      reuse: opts.reuse,
      lsp: opts.lsp,
      onProgress: ({ phase, index, total, file }) =>
        process.stderr.write(
          `\r${phase === "enrich" ? "summarizing" : "parsing"} ${index + 1}/${total}: ${file.slice(0, 50).padEnd(50)}`,
        ),
    });
    process.stderr.write("\n");
    console.log(`✓ wiring: ${g.nodes} nodes (${fmt(g.byKind)}), ${g.edges} edges, ${g.cards} cards [${g.languages.join(", ")}]`);
    console.log(`  parsed: ${g.parsed} of ${g.files} files (${g.reused} replayed from cache)`);
    // Worth one line: this build started from a graph the user never built *here*.
    if (g.seededFrom) console.log(`  seeded: copied a starting graph from ${g.seededFrom} (git worktree)`);
    if (deep) {
      const m = g.meaning;
      console.log(`  meaning: ${m.computed} computed, ${m.cached} cached, ${m.stale} stale, ${m.pending} pending`);
      // What the run actually spent. Every adapter normalizes this and nothing used
      // to report it, so the only way to find out what a repo-wide --deep cost was
      // to go and read the provider's dashboard afterwards. Tokens, not dollars:
      // see `Graft.usage()` for why a price would be a made-up number.
      const u = engine.usage();
      if (u.calls > 0) {
        const cached = u.cacheRead + u.cacheCreate;
        console.log(
          `  llm: ${formatCount(u.calls)} calls, ${formatCount(u.input)} input + ${formatCount(u.output)} output tokens` +
            (cached > 0 ? ` (${formatCount(cached)} cached)` : ""),
        );
      }
    }
    console.log(`  → ${g.contextDir}`);
    for (const e of g.errors) console.error(`✗ ${e}`);
    failures.push(...g.errors);

    const rel = relative(process.cwd(), g.contextDir) || "graft";
    console.log(`  ${rel}/ is git-ignored (added automatically) — a local cache; teammates run \`graft build\` to get their own.`);

    // A build that printed `✗` lines and then exited 0 read as a clean success to
    // everything that judges by status and not by stderr: CI, `graft build && …`,
    // the init path, the hooks. Those lines are files that never made it into the
    // graph (unreadable, unparseable) or summaries the model never returned — a
    // graph missing exactly what nobody was told to look for. The output is still
    // written and still useful, so this is `exitCode`, not an abort: the partial
    // graph stays, the run is just no longer reported as complete.
    // `runWorkspaceBuild` already does the same for a failed child repo.
    if (failures.length > 0) {
      console.error(`✗ ${failures.length} error(s) — the graph above is incomplete`);
      process.exitCode = 1;
    }
  });

program
  .command("ask")
  .description("Query the graft/ graph — returns ranked nodes + exact file:line, routed to prose or wiring ($0, no key)")
  .argument("<query>", "what you want to understand, in plain words")
  .argument(...DIR_ARG)
  .option("-n, --limit <n>", "max results", "8")
  .option("--source", "inline the source at each file:line hit (retriever mode — the pack IS the answer, no need to re-open files)")
  .option("--full", "with --source: inline whole definition spans instead of the default ≤8-line crux excerpts")
  .option("--in <path>", "narrow to nodes under this path prefix, filtered before scoring (segment-aware, like scopeOf)")
  .option("--json", "output the result as JSON")
  .option("--no-graph-rank", "rank by lexical relevance only, without the graph-connectivity re-rank (ablation/eval)")
  .option(...NO_REFRESH_FLAG)
  .action(async (query: string, dirArg: string | undefined, opts: { limit: string; source?: boolean; full?: boolean; in?: string; json?: boolean; refresh?: boolean; graphRank?: boolean }) => {
    // Validated here, in the same shape `--max-dirs` and `--depth` use, and BEFORE
    // `refreshBefore` so a typo doesn't cost a rebuild. `ask` guards its limit with
    // `?? 8`, which only covers null/undefined — a NaN from `Number("all")` sailed
    // through into `slice(0, NaN)`, and an empty slice is reported as "no matching
    // nodes — try different words", blaming the query for a bad flag. `-n 0` and
    // `-n -1` produced the same lie.
    const limit = parseInt(opts.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      console.error(`✗ -n/--limit must be a positive integer, got "${opts.limit}"`);
      process.exit(1);
      return;
    }
    const dir = queryRoot(dirArg);
    await refreshBefore(dir, opts);
    const askGlobalDir = program.opts<GlobalOpts>().dir;
    if (readWorkspace(dir, askGlobalDir)) {
      runWorkspaceAsk(dir, askGlobalDir, query, {
        limit, source: opts.source, full: opts.full, in: opts.in, json: opts.json,
      });
      return;
    }
    const engine = engineFrom();
    let r;
    try {
      r = engine.ask(dir, query, { limit, source: opts.source, full: opts.full, in: opts.in, graphRank: opts.graphRank });
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
  .argument(...DIR_ARG)
  .option("--json", "output the result as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(async (file: string, dirArg: string | undefined, opts: { json?: boolean; refresh?: boolean }) => {
    const dir = queryRoot(dirArg);
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
  .argument(...DIR_ARG)
  .option("-e, --extensions <exts...>", "code extensions to include (defaults to the repo's persisted `graft build -e` narrowing)")
  .option("--json", "output the drift as JSON")
  .action(async (dirArg: string | undefined, opts: { extensions?: string[]; json?: boolean }) => {
    warnUnsupportedExtensions(opts.extensions);
    const dir = queryRoot(dirArg);
    assertRepoDir(dir); // a typo'd [dir] is a named argument, not an ENOENT four frames down
    const checkGlobalDir = program.opts<GlobalOpts>().dir;
    if (readWorkspace(dir, checkGlobalDir)) {
      await runWorkspaceCheck(dir, checkGlobalDir);
      return;
    }
    const engine = engineFrom();
    // Falls back to what the BUILD narrowed to. Both layers, exactly as on the build
    // side: a graph built under `-e .ts` holds no Python nodes, and a check that
    // enumerated every language would report each excluded file as `added` forever —
    // drift that no `graft build` would ever "fix", because it isn't drift.
    const checkExts = opts.extensions ?? readExtensions(dir);
    const r = engine.check(dir, { extensions: checkExts });
    const g = await engine.checkGraph(dir, { extensions: checkExts }); // graph.json is only judged when it exists

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
  .argument(...DIR_ARG)
  .option("-p, --port <port>", "port to serve on", "4400")
  .option("--no-open", "don't open the browser")
  .action(async (dirArg: string | undefined, opts: { port: string; open: boolean }) => {
    const dir = queryRoot(dirArg);
    const { existsSync } = await import("node:fs");
    const { resolve, basename } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { contextDirFor } = await import("./context/node-file.js");
    const { openInBrowser } = await import("./cli-open.js");
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
    // Never fatal: on a headless box there is no opener to spawn, and the URL above
    // is the whole point of the command. See `cli-open.ts`.
    if (opts.open) openInBrowser(srv.url);
  });

program
  .command("mcp")
  .description("Serve the graph over MCP (stdio) — exposes graft_find_code, graft_trace_calls, graft_find_all, graft_file_api, graft_repo_map and graft_check_freshness as tools")
  .argument(...DIR_ARG)
  .action(async (dirArg: string | undefined) => {
    const dir = queryRoot(dirArg);
    const { startMcpServer } = await import("./mcp/server.js");
    const globalOpts = program.opts<{ dir?: string }>();
    startMcpServer(dir, globalOpts.dir, currentVersion);
  });

program
  .command("callers")
  .description(
    "Who calls/references a symbol ($0, no LLM). --direction out gives callees (what it calls); --depth N (or all) walks transitively for full blast radius",
  )
  .argument("<symbol>", "bare name, qualified (Class.method), or package-qualified (pkg.Fn)")
  .argument(...DIR_ARG)
  .option("--direction <in|out>", 'edge direction: "in" = callers (default), "out" = callees')
  .option("-d, --depth <n>", 'walk transitively up to N hops for blast radius, or "all" for the full connected closure (default 1)')
  .option("--in <path>", "narrow matches to nodes at or under this path prefix")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(
    async (
      symbol: string,
      dirArg: string | undefined,
      opts: { direction?: string; depth?: string; in?: string; json?: boolean; refresh?: boolean },
    ) => {
      const dir = queryRoot(dirArg);
      await refreshBefore(dir, opts);
      const globalOpts = program.opts<{ dir?: string }>();
      if (!opts.json && readWorkspace(dir, globalOpts.dir)) {
        runWorkspaceCallers(dir, globalOpts.dir, symbol, {
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
  .argument(...DIR_ARG)
  .option("-i, --ignore-case", "case-insensitive match")
  .option("--fixed", "treat pattern as a literal string, not a regex")
  .option("--in <path>", "narrow to files at or under this path prefix")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(
    async (
      pattern: string,
      dirArg: string | undefined,
      opts: { ignoreCase?: boolean; fixed?: boolean; in?: string; json?: boolean; refresh?: boolean },
    ) => {
      const dir = queryRoot(dirArg);
      await refreshBefore(dir, opts);
      const globalOpts = program.opts<{ dir?: string }>();
      if (readWorkspace(dir, globalOpts.dir)) {
        runWorkspaceGrep(dir, globalOpts.dir, pattern, {
          // `--in` used to stop here: federation forwarded ignoreCase/fixed only,
          // so at a workspace root the flag was accepted, dropped, and every repo
          // searched — a wider answer than the user asked for, silently.
          ignoreCase: opts.ignoreCase, fixed: opts.fixed, in: opts.in, json: opts.json,
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
  .argument(...DIR_ARG)
  .option("--max-dirs <n>", "max directory entries shown, rest counted into dropped (default 16)")
  .option("--json", "output as JSON")
  .option(...NO_REFRESH_FLAG)
  .action(async (dirArg: string | undefined, opts: { json?: boolean; maxDirs?: string; refresh?: boolean }) => {
    const dir = queryRoot(dirArg);
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
    // Before the picker, not after: `init` writes agent files, hooks and a stamp
    // into this path, and a typo would have created the whole tree — after asking
    // the user which agents to wire into it.
    assertRepoDir(repo);
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
        // Non-zero on every path that writes nothing, so `graft init && <next step>`
        // stops instead of continuing as if the repo were wired. Only `--dry-run`
        // and `--list-agents` write nothing *and* succeed — they were asked a
        // question, not told to install. The no-TTY path below is the one that
        // actually bites: in Git Bash / MSYS without winpty `stdin.isTTY` is false,
        // so a plain interactive `graft init` lands there and used to exit 0.
        process.exitCode = 1;
        return;
      }
      ids = picked;
    } else {
      console.error(formatNonInteractiveHelp(detectedIds));
      process.exitCode = 1;
      return;
    }

    // Workspace parent: every child repo gets its OWN wiring too. A session
    // opens at a repo root, not at the parent, and reads `.claude/` from there —
    // wiring only the parent leaves each child with no skill, hooks, or MCP.
    // The parent's own wiring stays (queries there federate across children).
    const children = isWorkspaceBuildRoot(repo, program.opts<GlobalOpts>().dir)
      ? discoverWorkspaceChildren(repo)
      : [];
    // Parent FIRST: its build is the workspace build, which builds every child's
    // graph, so each child's own `buildGraphIfMissing` then finds one and no-ops.
    const targets = [repo, ...children.map((c) => join(repo, c))];

    if (opts.dryRun) {
      console.error(formatPlan(plan, ids, repo, home));
      for (const child of children)
        console.error(`\n— ${child}/ (workspace child)\n` + formatPlan(planInit(join(repo, child), { home }), ids, join(repo, child), home));
      return;
    }
    if (ids.length === 0) {
      console.error("· no agents selected — nothing written");
      process.exitCode = 1;
      return;
    }

    const wantClaude = ids.includes("claude");
    const cliPath = fileURLToPath(import.meta.url);

    if (children.length)
      console.error(`· workspace: wiring ${repo} and ${children.length} child repo(s) — ${children.join(", ")}`);

    for (const target of targets) {
      if (target !== repo) console.error(`\n— ${relative(repo, target)}/`);
      wireTarget(target, ids, { home, cliPath, plan, opts, wantClaude });
    }

    // One epilogue for the whole run. A workspace parent holds no nodes of its
    // own, so the totals come from the children — the graph the user actually got.
    const globalDir = program.opts<GlobalOpts>().dir;
    const graphs = (children.length ? children.map((c) => join(repo, c)) : [repo])
      .map((d) => loadGraphCached(contextDirFor(d, children.length ? undefined : globalDir)))
      .filter((g): g is NonNullable<typeof g> => g !== null);
    console.error(
      "\n" +
        formatInitEpilogue({
          graphBuilt: graphs.length > 0,
          nodes: graphs.reduce((n, g) => n + g.meta.nodeCount, 0),
          edges: graphs.reduce((n, g) => n + g.meta.edgeCount, 0),
        }),
    );
  });

/** One repo's worth of `init` writes — the parent, then each workspace child. */
function wireTarget(
  repo: string,
  ids: string[],
  ctx: {
    home: string;
    cliPath: string;
    plan: ReturnType<typeof planInit>;
    wantClaude: boolean;
    opts: { build?: boolean; mcp?: boolean; hooks?: boolean; global?: boolean };
  },
): void {
    const { home, cliPath, plan, wantClaude, opts } = ctx;
    // Recorded in the stamp below so the NEXT init can tell a permission the user
    // deleted from one that was never offered here. Undefined when Claude Code
    // wasn't wired this run — writeStamp then carries the previous record forward
    // instead of erasing it.
    let offeredAllow: string[] | undefined;

    if (wantClaude) {
      const res = runInit(repo, { build: opts.build, cliPath });
      offeredAllow = res.offeredAllow;
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

    // Record WHICH graft wrote this repo's agent files, and under which flags.
    // Every entry point compares this against the running binary and re-writes
    // them on a mismatch, so an `npm i -g` upgrade reaches the hooks/skill/rules
    // too — not just the binary. The flags ride along so a refresh replays the
    // user's choices (notably --no-global) instead of overriding them.
    writeStamp(
      repo,
      currentVersion,
      ids,
      {
        global: opts.global !== false,
        mcp: opts.mcp !== false,
        hooks: opts.hooks !== false,
      },
      undefined,
      undefined, // the real homedir(): the memo is deliberately machine-global
      offeredAllow,
    );

    // Every host's wiring points at graft/, so the graph is built whatever was
    // selected — not only when Claude Code is in the list (runInit does its own).
    if (!wantClaude) {
      console.error(
        buildGraphIfMissing(repo, { build: opts.build, cliPath })
          ? "✓ built the graph (graft build)"
          : "· skipped graph build",
      );
    }

}

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
