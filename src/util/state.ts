/**
 * The `graft/.cache/` sidecar state: the statusline's stats snapshot and the
 * build lock that serializes rebuilds.
 *
 * Lives in `util/` rather than `claude/` because two very different callers need
 * it: the Claude Code hooks (which flip `dirty` on an edit and clear it after a
 * background sync) and the graph's own pre-query auto-refresh
 * (`graph/refresh.ts`), which must take the same lock so the two never rebuild
 * on top of each other. `claude/state.ts` re-exports all of this, so nothing
 * outside had to change when it moved.
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { GraphV1 } from '../graph/types.js';

export interface Stats {
  nodeCount: number; edgeCount: number; languages: string[];
  totalCount: number; readyCount: number;
  staleCount: number; dirty: boolean; syncing: boolean;
  syncedAt: string | null; lastFile: string | null;
}

export const LOCK_STALE_MS = 300000;

export function emptyStats(): Stats {
  return { nodeCount: 0, edgeCount: 0, languages: [], totalCount: 0, readyCount: 0,
    staleCount: 0, dirty: false, syncing: false, syncedAt: null, lastFile: null };
}

const LOCK_FILE = '.sync.lock';

export function cacheDir(projectDir: string): string { return join(projectDir, 'graft', '.cache'); }
function statsPath(d: string): string { return join(cacheDir(d), 'stats.json'); }

export function readJson<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; }
}
/**
 * Write `text` to `p` so a concurrent reader sees either the whole old file or the
 * whole new one — never a truncated prefix.
 *
 * `writeFileSync` truncates the destination to zero and *then* streams bytes into
 * it, so for the milliseconds that takes, anyone who opens the path reads a partial
 * document. Writing to a scratch file and renaming over the target avoids that
 * entirely: `rename` within a filesystem is atomic, and it replaces the directory
 * entry rather than modifying the file in place, so a reader that already opened
 * the old file keeps reading a complete one.
 *
 * The pid in the temp name keeps two concurrent writers off each other's scratch
 * file. This is the only atomic-write implementation in the codebase on purpose —
 * `graph/write.ts` uses it for `wiring.json`, which a query can now rewrite while
 * the statusline, a second graft process, or another MCP call is reading it.
 */
export function writeFileAtomic(p: string, text: string): void {
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, p);
}

/** {@link writeFileAtomic} for JSON. `compact` drops the indentation, for the
 * caches only a machine ever opens — it's ~30% of the bytes on a big, deep object. */
export function writeJsonAtomic(p: string, value: unknown, compact = false): void {
  writeFileAtomic(p, compact ? JSON.stringify(value) : JSON.stringify(value, null, 2));
}

export function readStats(d: string): Stats | null { return readJson<Stats>(statsPath(d)); }
export function writeStats(d: string, s: Stats): void { writeJsonAtomic(statsPath(d), s); }
// Best-effort read-modify-write; not atomic across concurrent processes, but acceptable
// for episodic hook writes (worst case is a lost update, not corruption).
export function patchStats(d: string, patch: Partial<Stats>): Stats {
  const next: Stats = { ...(readStats(d) ?? emptyStats()), ...patch };
  writeStats(d, next);
  return next;
}

export function acquireLock(d: string): boolean {
  return acquireLockIn(cacheDir(d));
}
export function releaseLock(d: string): void {
  releaseLockIn(cacheDir(d));
}

/**
 * The lock, addressed by cache dir rather than project dir. For the default layout
 * `<root>/graft/.cache` these are the same file, which is the point: the Claude Code
 * hooks lock by project dir and the graph's auto-refresh locks by the context dir it
 * is actually writing, and the two must collide so they can't rebuild at once.
 */
export function acquireLockIn(cache: string): boolean {
  const p = join(cache, LOCK_FILE);
  mkdirSync(cache, { recursive: true });
  const payload = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  try {
    writeFileSync(p, payload, { flag: 'wx' }); // atomic exclusive create
    return true;
  } catch (e: any) {
    if (e?.code !== 'EEXIST') throw e;
    let stale: boolean;
    try { stale = Date.now() - statSync(p).mtimeMs >= LOCK_STALE_MS; } catch { stale = true; }
    if (!stale) return false;
    try { rmSync(p); } catch { /* another process reclaimed it */ }
    try { writeFileSync(p, payload, { flag: 'wx' }); return true; }
    catch (e2: any) { if (e2?.code === 'EEXIST') return false; throw e2; }
  }
}
export function releaseLockIn(cache: string): void {
  try { rmSync(join(cache, LOCK_FILE)); } catch { /* already gone */ }
}

/** The graph-derived half of {@link Stats} — everything the statusline shows that
 * isn't drift state. Lives here so the hooks and the pre-query auto-refresh report
 * identical numbers. */
export function computeStats(
  w: GraphV1,
): Pick<Stats, 'nodeCount' | 'edgeCount' | 'languages' | 'totalCount' | 'readyCount'> {
  const nodes = w.nodes ?? [];
  const edges = w.edges ?? [];
  return {
    nodeCount: w.meta?.nodeCount ?? nodes.length,
    edgeCount: w.meta?.edgeCount ?? edges.length,
    languages: w.meta?.languages ?? [],
    totalCount: nodes.length,
    readyCount: nodes.filter((n) => n.summary_state === 'ready').length,
  };
}
