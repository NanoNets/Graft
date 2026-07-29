/**
 * `ensureFreshGraph` — the pre-query gate that keeps retrieval honest.
 *
 * Freshness used to be someone else's job: the Claude Code `Stop` hook spawned a
 * background `graft build` *after* the turn ended, so every query an agent made
 * between its first edit and the end of the turn answered from a graph that no
 * longer matched the file it had just changed. Worse, an edit made outside the
 * agent (your editor, a branch switch, a stash) set no `dirty` flag at all, so
 * nothing ever triggered a resync.
 *
 * So freshness moves into the query path: every retrieval call probes the working
 * tree (`fingerprint.ts`, ~3ms) and, when something moved, rebuilds the structural
 * graph before answering. Properties worth keeping:
 *
 * - **$0 and offline.** Tier-1 only — never a summarizer, never `--deep`. Same
 *   money guard `claude/sync-run.ts` carries: auto-anything must not spend money.
 * - **Never fatal.** A failed refresh degrades to answering from the graph on
 *   disk. A query that works today must not start failing because a rebuild did.
 * - **Never a stampede.** It takes the same `graft/.cache/.sync.lock` the
 *   background sync uses, so concurrent MCP calls and the Stop hook can't pile up
 *   rebuilds on top of each other.
 */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { contextDirFor } from "../context/node-file.js";
import { acquireLockIn, computeStats, patchStats, readStats, releaseLockIn } from "../util/state.js";
import { CACHE_DIR } from "../context/node-file.js";
import { buildGraph } from "./build.js";
import { driftCount, isClean, probeDrift, type Drift } from "./fingerprint.js";
import { invalidateGraphCaches } from "./load.js";
import { readGraph, wiringPath } from "./write.js";

/** How long to wait for another process's in-flight rebuild before giving up and
 * answering from the current graph. Long enough to ride out a small repo's build,
 * short enough that a tool call never feels hung. */
const LOCK_WAIT_MS = 2000;
const LOCK_POLL_MS = 50;

export interface RefreshResult {
  /** True when the graph on disk was rebuilt by this call. */
  refreshed: boolean;
  /** What the probe found, when it ran and found something. */
  drift?: Drift;
  /** One-line explanation for the agent/user, when there's something worth saying. */
  note?: string;
  /** Recoverable failures from the rebuild — a card that couldn't be written, a
   * concept node whose frontmatter didn't parse. The graph is fine; a projection
   * under `graft/` isn't, and nothing else would ever report it. */
  errors?: string[];
}

export interface RefreshOptions {
  contextDir?: string;
  /** Skip everything (the `--no-refresh` flag). */
  disabled?: boolean;
}

const CLEAN: RefreshResult = { refreshed: false };

/** Env kill switch, for CI or anyone who wants queries to never write. */
function envDisabled(): boolean {
  const v = process.env.GRAFT_NO_REFRESH;
  return v !== undefined && v !== "" && v !== "0" && v !== "false";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Release the lock if this process is asked to die while holding it. Returns the
 * un-hook.
 *
 * Not hypothetical: the Claude Code prompt hook runs `graft ask` with a timeout, and
 * `execFileSync` enforces it with SIGTERM. Node's default disposition for SIGTERM is
 * to exit without unwinding, so the `finally` below never runs and the lock outlives
 * the process — after which the background sync is blocked and every query waits and
 * then answers stale until the lock ages out. Ctrl-C on a CLI query is the same story
 * with SIGINT.
 *
 * Adding a listener replaces that default disposition, so re-raise it explicitly
 * afterwards: remove ourselves, then `process.kill(process.pid, sig)`, so the exit
 * status still says "terminated by signal" for whoever is waiting on us.
 */
export function releaseOnSignal(cache: string): () => void {
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  const onSignal = (sig: NodeJS.Signals) => {
    releaseLockIn(cache);
    for (const s of signals) process.removeListener(s, onSignal);
    process.kill(process.pid, sig);
  };
  for (const s of signals) process.once(s, onSignal);
  return () => {
    for (const s of signals) process.removeListener(s, onSignal);
  };
}

/** Wait out someone else's rebuild, then take the lock. False when we couldn't. */
async function waitForLock(cache: string): Promise<boolean> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    if (acquireLockIn(cache)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(LOCK_POLL_MS);
  }
}

/**
 * Rebuild `root`'s structural graph if the working tree has moved since the last
 * build. Cheap and side-effect-free when nothing changed, which is the usual case.
 *
 * `root` is the repository root (the same value the query itself is given), not
 * the context dir.
 */
export async function ensureFreshGraph(root: string, opts: RefreshOptions = {}): Promise<RefreshResult> {
  if (opts.disabled || envDisabled()) return CLEAN;
  try {
    const dir = resolve(root);
    const outDir = contextDirFor(dir, opts.contextDir);
    // Nothing built yet: the caller's own "no graph — run graft build" message is
    // the right answer. Auto-building a whole repo under a query is a surprise,
    // and it's the one case where the user hasn't opted into graft at all yet.
    if (!existsSync(wiringPath(outDir))) return CLEAN;

    // null = no fingerprint at all: a graph built before this mechanism existed,
    // or by a different extractor build. Rebuild once — that lays the fingerprint
    // down, so it costs exactly one build, not one per query.
    const drift = probeDrift(dir, outDir);
    if (drift && isClean(drift)) return CLEAN;

    // On the default layout this is `<root>/graft/.cache/.sync.lock`, the very file
    // the Claude Code hooks lock — so this refresh and the background sync can
    // never rebuild at the same time.
    const lockCache = join(outDir, CACHE_DIR);
    if (!(await waitForLock(lockCache))) {
      return {
        refreshed: false,
        drift: drift ?? undefined,
        note: "a graph rebuild is already in flight — answering from the current graph",
      };
    }
    const unhook = releaseOnSignal(lockCache);
    try {
      // We may have queued behind another process's rebuild for up to LOCK_WAIT_MS,
      // and that rebuild very likely fixed the same drift we saw. Re-probe rather
      // than rebuild on the strength of a stale observation: without this, four
      // parallel MCP tool calls on one edited file produce four full rebuilds, three
      // of them pure waste, and the last tool call pays for all of it. A null drift
      // means "no fingerprint" and still has to build.
      const now = drift ? probeDrift(dir, outDir) : null;
      if (now && isClean(now)) {
        invalidateGraphCaches(outDir);
        return CLEAN;
      }
      // Tier-1 only: no summarizer, so no LLM call and no network, ever.
      const built = await buildGraph(dir, { contextDir: opts.contextDir });
      invalidateGraphCaches(outDir);
      syncStats(dir, outDir);
      // The graph itself is current, but a projection under `graft/` may have failed
      // (a read-only card, ENOSPC). That can't be expressed as staleness — the
      // fingerprint is written and the next probe is clean by design — so say it out
      // loud instead of letting the passive markdown surface rot in silence.
      return { refreshed: true, drift: drift ?? undefined, errors: built.errors };
    } finally {
      unhook();
      releaseLockIn(lockCache);
    }
  } catch (err) {
    // Answering from a slightly stale graph beats failing the query.
    return { refreshed: false, note: `graph refresh skipped: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Mirror what the background sync writes, so the statusline flips to `✓ synced`
 * mid-turn instead of showing `⚠ stale` until the turn ends. Best-effort: this is
 * a display cache, and the stats file only exists in a hooked-up repo anyway. */
function syncStats(dir: string, outDir: string): void {
  try {
    if (!readStats(dir)) return; // no hooks in this repo — nothing reads it
    const w = readGraph(wiringPath(outDir));
    if (!w) return;
    patchStats(dir, {
      dirty: false,
      staleCount: 0,
      syncing: false,
      syncedAt: new Date().toISOString(),
      ...computeStats(w),
    });
  } catch {
    /* display-only — never let this fail a query */
  }
}

/**
 * Workspace variant: refresh each child repo's own graph (a workspace parent holds
 * an index, never nodes). Children are independent, but they're refreshed in
 * sequence — a fan-out of concurrent tree-sitter builds would spike CPU on the
 * very path that's supposed to feel free.
 */
export async function ensureFreshChildren(
  root: string,
  children: string[],
  opts: RefreshOptions = {},
): Promise<RefreshResult> {
  if (opts.disabled || envDisabled()) return CLEAN;
  const refreshedIn: string[] = [];
  let files = 0;
  for (const child of children) {
    // Deliberately NOT `opts`: `contextDirFor` returns an override verbatim and
    // ignores the root it's handed, so forwarding the parent's `--dir` would point
    // every child at the *parent's* context dir — which holds a workspace index and
    // no wiring.json, so every child would silently be skipped. (And if it did hold
    // one, each child would build into that single shared dir in turn, the last
    // clobbering the rest.) A child's graph always lives in its own `<child>/graft`,
    // which is exactly how `loadWorkspaceGraphs` reads them back.
    const r = await ensureFreshGraph(resolve(root, child), { disabled: opts.disabled });
    if (!r.refreshed) continue;
    refreshedIn.push(child);
    files += r.drift ? driftCount(r.drift) : 0;
  }
  if (!refreshedIn.length) return CLEAN;
  return {
    refreshed: true,
    note: `refreshed ${refreshedIn.join(", ")} (${files || "?"} file${files === 1 ? "" : "s"} changed) before answering`,
  };
}

/** The one-line note a CLI/MCP surface prints when a refresh actually happened.
 * Null when there's nothing to say (the overwhelmingly common case). */
export function refreshNote(r: RefreshResult): string | null {
  if (r.note) return `[graft] ${r.note}${errorTail(r)}`;
  if (!r.refreshed) return null;
  const n = r.drift ? driftCount(r.drift) : 0;
  return `[graft] refreshed the graph (${n || "?"} file${n === 1 ? "" : "s"} changed) before answering${errorTail(r)}`;
}

/** Projection failures, condensed. The first one is usually the whole story (they
 * share a cause — a permission, a full disk), so name it and count the rest. */
function errorTail(r: RefreshResult): string {
  const errs = r.errors ?? [];
  if (!errs.length) return "";
  const more = errs.length > 1 ? ` (+${errs.length - 1} more)` : "";
  return `; ${errs.length} write error${errs.length === 1 ? "" : "s"} under graft/: ${errs[0]}${more}`;
}
