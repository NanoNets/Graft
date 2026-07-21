/**
 * mtime-keyed in-process cache over the two readers `ask()` calls on every
 * query: the wiring graph (`readGraph`) and the ask sidecar (`readAskIndex`).
 * `graft ask` re-parses these from disk on every invocation; in a long-lived
 * process — the MCP server, or `graft ask` invoked repeatedly in one process —
 * that means re-parsing the same ~tens-of-MB JSON on every tool call.
 *
 * Keyed by `(path, mtimeMs, size)` from `statSync`, so a rebuild (`graft
 * build`) is picked up on the very next call with no polling and no TTL: the
 * stat is cheap relative to the parse it guards, and a changed mtime or size
 * invalidates the entry. A missing file returns null and is never cached — the
 * next call re-stats, so a file created after a prior miss is picked up
 * immediately (no negative caching).
 *
 * **Cache invalidation assumption:** This strategy assumes filesystem mtime
 * resolution is finer than build cadence. This is safe because `graft build`
 * rewrites the entire output file atomically, so same-size rewrites within a
 * single mtime tick (which would serve stale data) are infeasible in practice.
 * On APFS (macOS) mtime is nanosecond-granular and a build takes milliseconds,
 * so invalidation is immediate and reliable.
 *
 * Dependency-free by design: this module imports only `node:fs`, `./write.js`,
 * and `../ask/index-file.js`, so it can be imported from both `ask.ts` and
 * `mcp/tools.ts` without creating an import cycle.
 */
import { statSync } from "node:fs";
import { readGraph, wiringPath } from "./write.js";
import { readAskIndex, askIndexPath, type AskIndex } from "../ask/index-file.js";
import type { GraphV1 } from "./types.js";

interface CacheEntry<T> {
  mtimeMs: number;
  size: number;
  value: T | null;
}

const graphCache = new Map<string, CacheEntry<GraphV1>>();
const askIndexCache = new Map<string, CacheEntry<AskIndex>>();

/** Real parses performed (cache misses), not cache hits — exported for tests
 * so the invalidation contract can be pinned down without spying on `fs`. */
export const __parseCount = { graph: 0, askIndex: 0 };

/** Test-only: zero the counters (module state persists across a test file). */
export function __resetParseCounts(): void {
  __parseCount.graph = 0;
  __parseCount.askIndex = 0;
}

function statOf(path: string): { mtimeMs: number; size: number } | null {
  try {
    const s = statSync(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

function loadCached<T>(
  cache: Map<string, CacheEntry<T>>,
  path: string,
  parse: () => T | null,
  onParse: () => void,
): T | null {
  const st = statOf(path);
  if (!st) {
    // Missing file: don't negatively cache, and drop any stale entry so a
    // subsequently-created file at the same path is re-parsed, not served
    // from a cache keyed to the old (mtime, size).
    cache.delete(path);
    return null;
  }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.value;
  }
  onParse();
  const value = parse();
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
}

/** Cached `readGraph(wiringPath(outDir))` — same null-on-missing/unparseable
 * semantics, re-reads only when the wiring file's `(mtimeMs, size)` changed.
 * Returns a shared cached reference; callers must not mutate the returned graph. */
export function loadGraphCached(outDir: string): GraphV1 | null {
  const path = wiringPath(outDir);
  return loadCached(graphCache, path, () => readGraph(path), () => {
    __parseCount.graph++;
  });
}

/** Cached `readAskIndex(outDir)` — same semantics, keyed on the sidecar file.
 * Returns a shared cached reference; callers must not mutate the returned index. */
export function loadAskIndexCached(outDir: string): AskIndex | null {
  const path = askIndexPath(outDir);
  return loadCached(askIndexCache, path, () => readAskIndex(outDir), () => {
    __parseCount.askIndex++;
  });
}
