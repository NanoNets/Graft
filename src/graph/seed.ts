/**
 * `seedGraph` — give a linked git worktree the graph its parent checkout already has.
 *
 * `graft/` is a local cache, so it is gitignored, so `git worktree add` never checks
 * it out: a worktree starts with `src/` and `.claude/` and no graph at all. Every
 * MCP tool then answers "no graph found — run graft build first" for the whole
 * session, and the passive surface (`INDEX.md`, the cards) is missing too. The agent
 * that was supposed to be cheapest in a fresh worktree is instead blind in one.
 *
 * The parent checkout has not gone anywhere, though — a worktree's `.git` is a *file*
 * naming it, and the harness that creates these worktrees already reaches back the
 * same way (Claude Code symlinks `node_modules` to the parent's). So: copy the
 * parent's `graft/` in, then let the ordinary refresh gate repair the difference.
 *
 * Copy, not symlink. `node_modules` is the same for every branch; a graph is a set of
 * `file:line` spans for one specific tree, so a shared one would have the worktree
 * rewriting the parent's graph with its own branch's line numbers. What makes the
 * copy worth doing rather than just rebuilding cold:
 *
 * - **The Tier-2 meaning layer survives.** Summaries and cruxes cost real money;
 *   `buildGraph` folds a prior `wiring.json` in by `body_hash`, so an unchanged
 *   function keeps the summary someone already paid for. A cold build throws them all
 *   away and the worktree silently drops to structural-only answers.
 * - **The repair is small.** `probeDrift` confirms a suspect file by content hash, so
 *   a fresh checkout's brand-new mtimes cost one hashing pass and nothing more; the
 *   drift that survives is exactly the diff between the two checkouts' commits.
 * - **$0 and offline**, like everything else on the query path.
 *
 * Never writes to the parent, never throws, and no-ops unless there is genuinely a
 * built parent checkout on disk — so a fresh clone, CI, or a cloud session whose repo
 * was *cloned* rather than worktree'd behaves exactly as it did before: "run graft
 * build first".
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CACHE_DIR, contextDirFor } from "../context/node-file.js";
import { GRAPH_DIR, GRAPH_FILE, wiringPath } from "./write.js";

/** Env kill switch, mirroring `GRAFT_NO_REFRESH` in ./refresh.ts. */
export function seedDisabled(): boolean {
  const v = process.env.GRAFT_NO_SEED;
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

/**
 * The main checkout of the repo `root` is a linked worktree of, or null when `root`
 * isn't one (which is the common case, and not an error).
 *
 * Filesystem-only on purpose: no `git` subprocess on a path that runs before every
 * query. The shapes it has to tell apart:
 *
 * - `<root>/.git` is a **directory** → this *is* the main checkout. Nothing to seed.
 * - `gitdir: <main>/.git/worktrees/<name>` → a linked worktree. `commondir` inside
 *   that dir points back at the shared `.git` (`../..`), whose parent is the main
 *   checkout.
 * - `gitdir: <super>/.git/modules/<name>` → a **submodule**. Identical file shape,
 *   completely different thing: a submodule is its own repo and its parent's `graft/`
 *   describes different code entirely. The `worktrees` path segment is what rejects it.
 * - A bare repo or `--separate-git-dir` layout, where the resolved common dir isn't
 *   named `.git` and there may be no working tree at all → null.
 */
export function mainWorktreeRoot(root: string): string | null {
  try {
    const dot = join(root, ".git");
    if (statSync(dot).isDirectory()) return null;
    const m = /^gitdir:[ \t]*(.+?)[ \t]*$/m.exec(readFileSync(dot, "utf8"));
    if (!m) return null;
    const gitdir = isAbsolute(m[1]) ? m[1] : resolve(root, m[1]);
    if (basename(dirname(gitdir)) !== "worktrees") return null;
    const rel = readFileSync(join(gitdir, "commondir"), "utf8").trim();
    if (!rel) return null;
    const common = isAbsolute(rel) ? rel : resolve(gitdir, rel);
    if (basename(common) !== ".git" || !statSync(common).isDirectory()) return null;
    const main = dirname(common);
    if (resolve(main) === resolve(root)) return null;
    return main;
  } catch {
    // No `.git` at all, an unreadable one, a `commondir` that doesn't exist: all of
    // them mean "can't seed from here", which is the same answer as "not a worktree".
    return null;
  }
}

export interface SeedResult {
  seeded: boolean;
  /** The main checkout the graph came from, when one was used. */
  from?: string;
}

const NOT_SEEDED: SeedResult = { seeded: false };

/**
 * Repo-relative paths (posix) that a seed deliberately leaves behind.
 *
 * `wiring.json` is here because it is copied last and atomically — see `installGraph`.
 * The rest is state that belongs to the checkout that produced it: another process's
 * lock, another session's transcripts, and another checkout's savings/dirty counters.
 */
const SKIP = new Set([
  `${GRAPH_DIR}/${GRAPH_FILE}`,
  `${CACHE_DIR}/.sync.lock`,
  `${CACHE_DIR}/session`,
  `${CACHE_DIR}/stats.json`,
]);

function copyTree(srcDir: string, outDir: string): void {
  cpSync(srcDir, outDir, {
    recursive: true,
    // A directory that returns false is skipped whole, which is what keeps
    // `.cache/session/` (one file per session, forever) out of the copy.
    filter: (src) => !SKIP.has(relative(srcDir, src).split(sep).join("/")),
  });
}

/**
 * Put `wiring.json` in place last, via a temp file and a rename.
 *
 * Its presence is the flag every caller reads to mean "this repo has a graph"
 * (`refresh.ts`, `workspace.ts`, every MCP tool). So it must appear only once the
 * rest of the copy has landed and must never appear half-written: a seed killed
 * midway then leaves no graph, and the next call simply seeds again.
 */
function installGraph(srcGraph: string, destGraph: string): void {
  mkdirSync(dirname(destGraph), { recursive: true });
  const tmp = `${destGraph}.seed.${process.pid}`;
  try {
    copyFileSync(srcGraph, tmp);
    renameSync(tmp, destGraph);
  } catch (err) {
    try { rmSync(tmp, { force: true }); } catch { /* nothing to clean up */ }
    throw err;
  }
}

/**
 * Copy the parent checkout's graph into `root`'s own `graft/`, if all of this holds:
 * `root` is a linked worktree, it has no graph yet, the parent has one, and no `--dir`
 * override is in play (a custom output dir can't be mapped to a sibling checkout —
 * the same conservatism `ensureGitignored` applies).
 *
 * Best-effort by contract: the caller's fallback is the behaviour that existed before
 * this function did, so every failure returns `{ seeded: false }` rather than raising.
 */
export function seedGraph(root: string, opts: { contextDir?: string } = {}): SeedResult {
  if (opts.contextDir || seedDisabled()) return NOT_SEEDED;
  try {
    const dir = resolve(root);
    const outDir = contextDirFor(dir);
    if (existsSync(wiringPath(outDir))) return NOT_SEEDED; // already has its own
    const main = mainWorktreeRoot(dir);
    if (!main) return NOT_SEEDED;
    const srcDir = contextDirFor(main);
    const srcGraph = wiringPath(srcDir);
    if (!existsSync(srcGraph)) return NOT_SEEDED; // parent never built either
    copyTree(srcDir, outDir);
    installGraph(srcGraph, wiringPath(outDir));
    return { seeded: true, from: main };
  } catch {
    return NOT_SEEDED;
  }
}
