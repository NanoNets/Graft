/**
 * The wired-up version of `./upkeep.ts` — one call every entry point makes.
 *
 * Split from `upkeep.ts` so that module stays pure and unit-testable (no init
 * writes, no spawning): this file is the only place that knows how to actually
 * re-run the wiring, and it is deliberately thin.
 */
import { runInit } from './claude/init.js';
import { runHostsInit } from './hosts/init.js';
import { graftCliPath } from './claude/paths.js';
import {
  formatUpdateNudge,
  formatWiringRefresh,
  maybeRefreshInBackground,
  readUpdateCache,
  reconcileWiring,
  type WiringOpts,
} from './upkeep.js';

export interface UpkeepResult {
  /** Lines worth showing the agent/user, already formatted. Usually empty. */
  lines: string[];
}

/**
 * Re-write the wiring for exactly the hosts a previous `init` chose here, with
 * exactly the flags it was given.
 *
 * `build: false` matters: this runs at session start and at MCP boot, and a graph
 * build there would stall the agent's first turn.
 *
 * The out-of-repo writes (`~/.codex/hooks.json`, `~/.codex/config.toml`) ARE
 * included, because nothing else would ever refresh them: no skill, rule file, or
 * MCP instruction tells an agent to run `graft init`, so leaving them out means a
 * Codex user upgrades the binary and keeps the old hook config forever. They're
 * safe to replay — `installCodexHooks` no-ops when `~/.codex` is absent, rewrites
 * only its own entry (matched on `graft-hooks.cjs`), and reports `unchanged` when
 * the bytes match. A user who declined them at init time is honoured via
 * `opts.global`/`opts.hooks`, replayed from the stamp (or, when the stamp went with
 * a `graft/` that is git-ignored, from the machine-global memo beside it).
 *
 * Returns init's warnings rather than dropping them: this path — not the CLI — is
 * how most repos get re-inited, so a warning only the CLI printed (say, "your
 * settings.json is not valid JSON, left untouched") would never reach the one
 * person who needs it.
 */
function rewriteWiring(
  repo: string,
  hosts: string[],
  opts: WiringOpts,
): { warnings: string[]; offeredAllow?: string[] } {
  const warnings: string[] = [];
  let offeredAllow: string[] | undefined;
  if (hosts.includes('claude')) {
    const r = runInit(repo, { build: false, cliPath: graftCliPath() });
    warnings.push(...r.warnings);
    // Handed back so `reconcileWiring` can put it in the stamp it writes right
    // after this returns: that stamp is the only record of which permissions were
    // ever offered here, and without it the next refresh re-adds the ones the user
    // deleted — into a file the whole team pulls.
    offeredAllow = r.offeredAllow;
  }
  const others = hosts.filter((h) => h !== 'claude');
  if (others.length)
    runHostsInit(repo, { agents: others, global: opts.global, mcp: opts.mcp, hooks: opts.hooks });
  return { warnings, offeredAllow };
}

/**
 * @param repo    the project dir
 * @param current the running graft's version
 * @param opts.background  false in hook contexts: read the update cache, never
 *   spawn a fetch. Hooks run under a hard timeout and must stay off the network.
 */
export function runUpkeep(
  repo: string,
  current: string,
  opts: { background?: boolean; home?: string } = {},
): UpkeepResult {
  const lines: string[] = [];
  try {
    const warnings: string[] = [];
    const refreshed = reconcileWiring(repo, current, {
      rewrite: (r, h, o) => {
        const res = rewriteWiring(r, h, o);
        warnings.push(...res.warnings);
        return { offeredAllow: res.offeredAllow };
      },
      home: opts.home,
    });
    const refreshLine = formatWiringRefresh(refreshed);
    if (refreshLine) lines.push(refreshLine);
    for (const w of warnings) lines.push(`⚠ ${w}`);
  } catch { /* fail-soft: wiring refresh is never worth breaking a session for */ }
  try {
    if (opts.background !== false) maybeRefreshInBackground(opts.home);
    const nudge = formatUpdateNudge(current, readUpdateCache(opts.home)?.latest);
    if (nudge) lines.push(nudge);
  } catch { /* same */ }
  return { lines };
}
