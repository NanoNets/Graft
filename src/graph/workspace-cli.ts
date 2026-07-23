/**
 * CLI print/exit wrappers + per-child build orchestration for workspace
 * federation. Kept out of both `cli.ts` (so routing there stays a one-liner
 * per command) and `workspace.ts` (so the core stays free of process/exit and
 * engine dependencies). The federated command bodies live in `workspace.ts`;
 * this file only renders them and wires the child builds through the engine.
 */
import { Graft } from "../engine.js";
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
}

/** Build every git child into its own committable `graft/`, then replace the
 * parent's `graft/` with `workspace.json`. Prints the one-time split warning
 * first when migrating away from a mega-graph. */
export async function runWorkspaceBuild(root: string, opts: WorkspaceBuildOptions): Promise<void> {
  const buildChild = async (childDir: string, childName: string): Promise<void> => {
    const engine = new Graft({ ...opts.childConfig, contextDir: undefined });
    if (opts.deep) await engine.init(childDir, { extensions: opts.extensions });
    const g = await engine.graph(childDir, { llm: opts.deep, concurrency: opts.concurrency });
    console.log(`✓ ${childName}/: ${g.nodes} nodes, ${g.edges} edges, ${g.cards} cards [${g.languages.join(", ")}]`);
    for (const e of g.errors) console.error(`✗ ${childName}/: ${e}`);
  };

  const { children } = await splitWorkspace(
    root,
    opts.override,
    buildChild,
    ({ children, migrated }) => {
      if (migrated) console.error(migrationNote(children));
      console.error(`building ${children.length} workspace repos: ${children.join(", ")}`);
    },
  );
  console.log(`✓ workspace: ${children.length} repos federated → graft/workspace.json`);
  console.log(`  commit each repo's graft/ and this folder's graft/workspace.json.`);
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
  opts: { ignoreCase?: boolean; fixed?: boolean; json?: boolean },
): void {
  const { result, coverage } = federateGrep(root, override, pattern, { ignoreCase: opts.ignoreCase, fixed: opts.fixed });
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

export function runWorkspaceCheck(root: string, override?: string): void {
  const { text, ok } = federateCheck(root, override);
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
