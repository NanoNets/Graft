import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWiring, computeStats } from './stats.js';
import { patchStats, releaseLock, resolveContextDir } from './state.js';
import { graftCliPath } from './paths.js';

/** MONEY GUARD: plain `graft build` only — structural, $0, offline. Never --deep. */
function realBuild(dir: string): void {
  // GRAFT_TEST_CLI is the same seam hooks.ts's graftJson uses, so a test can
  // point this at a stub and inspect the exact argv it was invoked with.
  const cliPath = process.env.GRAFT_TEST_CLI ?? graftCliPath();
  const args = [cliPath, 'build', '.'];
  // Mirrors `withContextDirArg` in hooks.ts: a no-op unless GRAFT_DIR is set, so an
  // unconfigured repo's rebuild sees byte-identical argv to before this existed.
  if (process.env.GRAFT_DIR) args.push('--dir', resolveContextDir(dir));
  // Keep the walk the last build chose. A `--only-dir` / `--exclude-dir` build
  // records its lists in the fingerprint and the query-path refresh re-applies
  // them (refresh.ts); this rebuild must too, or the first end-of-turn sync after
  // such a build silently widened the graph back to the whole tree.
  args.push(...lastWalkFlags(resolveContextDir(dir)));
  execFileSync(process.execPath, args, { cwd: dir, stdio: 'ignore', timeout: 120000 });
}

/** The last build's `--only-dir` / `--exclude-dir` lists as CLI flags, read
 * straight off the newest fingerprint sidecar with plain fs — no extractor-stamp
 * check (even a fingerprint from an older build records the walk the person who
 * last built chose), and no import of the graph modules into a hook process. */
export function lastWalkFlags(outDir: string): string[] {
  const cache = join(outDir, '.cache');
  let newest: { path: string; mtime: number } | null = null;
  try {
    for (const name of readdirSync(cache)) {
      if (!name.startsWith('fingerprint.') || !name.endsWith('.json')) continue;
      const path = join(cache, name);
      const mtime = statSync(path).mtimeMs;
      if (!newest || mtime > newest.mtime) newest = { path, mtime };
    }
  } catch {
    return [];
  }
  if (!newest) return [];
  try {
    const fp = JSON.parse(readFileSync(newest.path, 'utf8')) as { onlyDirs?: unknown; excludeDirs?: unknown };
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const flags: string[] = [];
    for (const d of list(fp.onlyDirs)) flags.push('--only-dir', d);
    for (const d of list(fp.excludeDirs)) flags.push('--exclude-dir', d);
    return flags;
  } catch {
    return [];
  }
}

export function runSync(dir: string, build: (d: string) => void = realBuild): void {
  try {
    build(dir);
    const w = readWiring(dir);
    if (!w) { patchStats(dir, { syncing: false }); return; } // build ran but output unreadable — stay dirty, retry
    patchStats(dir, {
      dirty: false, staleCount: 0, syncing: false, syncedAt: new Date().toISOString(),
      ...computeStats(w),
    });
  } catch {
    patchStats(dir, { syncing: false }); // leave dirty=true; retry next turn
  } finally {
    releaseLock(dir);
  }
}

export function main(): void {
  const dir = process.argv[2];
  if (dir) runSync(dir);
}

// Run only when executed directly (node dist/claude/sync-run.js <dir>), not on import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
