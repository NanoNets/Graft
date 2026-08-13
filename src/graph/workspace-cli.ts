/**
 * CLI print/exit wrappers + per-child build orchestration for workspace
 * federation. Kept out of both `cli.ts` (so routing there stays a one-liner
 * per command) and `workspace.ts` (so the core stays free of process/exit and
 * engine dependencies). The federated command bodies live in `workspace.ts`;
 * this file only renders them and wires the child builds through the engine.
 */
import { Graft } from "../engine.js";
import { contextDirFor, ensureGitignored } from "../context/node-file.js";
import { writeBuildConfig } from "../util/state.js";
import type { EngineConfig } from "../ai/providers.js";
import { formatAsk } from "../ask/ask.js";
import type { Direction } from "./traverse.js";
import {
  federateAsk,
  federateCallers,
  federateCheck,
  federateGrep,
  federateMap,
  formatGrepResult,
  migrationNote,
  splitWorkspace,
  zeroHitNote,
} from "./workspace.js";

export interface WorkspaceBuildOptions {
  deep: boolean;
  extensions?: string[];
  concurrency?: number;
  /** Provider/model/key config for child builds — WITHOUT any contextDir
   * override, so each child writes to its own `<child>/graft/`. */
  childConfig: EngineConfig;
  override?: string;
  /** The CLI's `--include-dir` override, if any. Persisted into EACH CHILD's
   * own state (not the parent's) before that child builds: children are
   * independent repos with their own local settings and can later be rebuilt
   * directly without seeing the parent invocation's flags. */
  includeDirs?: string[];
}

type ChildBuilder = (childDir: string, childName: string) => Promise<void>;

/**
 * Wrap a per-child build so ONE failure doesn't cost the whole workspace.
 *
 * splitWorkspace builds children in sequence and awaits each, so an uncaught
 * rejection from child 3 of 12 propagated to `parseAsync().catch` →
 * `process.exit(1)` and the other nine were never built. The failures that
 * actually happen here — an expired key, a 429 — are exactly the ones that hit
 * every child alike, which is the worst possible moment to abandon the queue: a
 * partial run still delivers the repos that worked.
 *
 * `failed` collects the names so the caller can still exit non-zero; swallowing
 * the error must not also make a half-built workspace look clean to CI.
 */
export function keepGoingOnChildFailure(build: ChildBuilder, failed: string[]): ChildBuilder {
  return async (childDir, childName) => {
    try {
      await build(childDir, childName);
    } catch (err) {
      failed.push(childName);
      console.error(`✗ ${childName}/: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/** Build every git child into its own committable `graft/`, then replace the
 * parent's `graft/` with `workspace.json`. Prints the one-time split warning
 * first when migrating away from a mega-graph. */
export async function runWorkspaceBuild(root: string, opts: WorkspaceBuildOptions): Promise<void> {
  const failed: string[] = [];
  const buildChild = keepGoingOnChildFailure(async (childDir, childName) => {
    // Persisted BEFORE the child build itself runs, same as the single-repo
    // `graft build --include-dir` path in cli.ts — so this child's walks (and
    // every later no-flag build of it) see the override identically.
    if (opts.includeDirs && opts.includeDirs.length > 0) {
      writeBuildConfig(childDir, { includeDirs: opts.includeDirs });
    }
    // Same for `-e`, and for the same reason plus one: the child's own freshness
    // probe and pre-query refresh never see a flag, so without this the first query
    // against that child would rebuild it wide again.
    if (opts.extensions && opts.extensions.length > 0) {
      writeBuildConfig(childDir, { extensions: opts.extensions });
    }
    const engine = new Graft({ ...opts.childConfig, contextDir: undefined });
    // Both phases get both flags: `-e` narrows what a child indexes at all, and
    // `-j` is usually set to survive a rate limit — which a workspace build, being
    // N repos through one key, is the likeliest run of all to hit.
    if (opts.deep) await engine.init(childDir, { extensions: opts.extensions, concurrency: opts.concurrency });
    const g = await engine.graph(childDir, {
      llm: opts.deep,
      extensions: opts.extensions,
      concurrency: opts.concurrency,
    });
    console.log(`✓ ${childName}/: ${g.nodes} nodes, ${g.edges} edges, ${g.cards} cards [${g.languages.join(", ")}]`);
    for (const e of g.errors) console.error(`✗ ${childName}/: ${e}`);
  }, failed);

  const { children } = await splitWorkspace(
    root,
    opts.override,
    buildChild,
    ({ children, migrated }) => {
      if (migrated) console.error(migrationNote(children));
      console.error(`building ${children.length} workspace repos: ${children.join(", ")}`);
    },
  );
  // Each child self-ignored during its own build; the parent's federation
  // index (graft/workspace.json) is written outside buildGraph, so ignore it here too.
  ensureGitignored(root, contextDirFor(root, opts.override));
  console.log(`✓ workspace: ${children.length} repos federated → graft/workspace.json`);
  console.log(`  graft/ is git-ignored — each teammate runs \`graft build\` to regenerate it locally.`);
  // Continuing past the failures bought a complete run; it must not also make a
  // half-built workspace look clean to CI or to a `&&` chain in a shell script.
  if (failed.length > 0) {
    console.error(`✗ ${failed.length} of ${children.length} repos failed to build: ${failed.join(", ")}`);
    process.exit(1);
  }
}

export function runWorkspaceAsk(
  root: string,
  override: string | undefined,
  query: string,
  opts: { limit?: number; source?: boolean; full?: boolean; in?: string; json?: boolean },
): void {
  const r = federateAsk(root, override, query, { limit: opts.limit, source: opts.source, full: opts.full, in: opts.in });
  if (opts.json) console.log(JSON.stringify(r, null, 2));
  else process.stdout.write(formatAsk(r));
}

export function runWorkspaceGrep(
  root: string,
  override: string | undefined,
  pattern: string,
  opts: { ignoreCase?: boolean; fixed?: boolean; in?: string; json?: boolean },
): void {
  const { result, coverage } = federateGrep(root, override, pattern, {
    ignoreCase: opts.ignoreCase,
    fixed: opts.fixed,
    in: opts.in,
  });
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.totalHits === 0) {
    console.error(coverage ? `${zeroHitNote(result)}\n${coverage}` : zeroHitNote(result));
    return;
  }
  process.stdout.write(formatGrepResult(result));
  if (coverage) console.log(coverage);
}

export function runWorkspaceMap(
  root: string,
  override: string | undefined,
  opts: { maxDirs?: number },
): void {
  process.stdout.write(federateMap(root, override, { maxDirs: opts.maxDirs }));
}

export async function runWorkspaceCheck(root: string, override?: string): Promise<void> {
  const { text, ok } = await federateCheck(root, override);
  process.stdout.write(text);
  if (!ok) process.exit(1);
}

export function runWorkspaceCallers(
  root: string,
  override: string | undefined,
  symbol: string,
  opts: { direction?: Direction; depth?: number; in?: string },
): void {
  const { text, found } = federateCallers(root, override, symbol, opts);
  if (!found) {
    console.error(`✗ ${text}`);
    process.exit(1);
  }
  process.stdout.write(text + "\n");
}
