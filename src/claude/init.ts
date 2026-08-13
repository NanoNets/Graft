import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeGraftSettings } from './settings-merge.js';
import { priorAllowOffers } from '../upkeep.js';
import { statuslineShim, hooksShim } from './shim-template.js';
import { skillTemplate } from './skill-template.js';
import { claudeDistDir } from './paths.js';
import { mergeJsonKey, serverEntry, type McpWrite } from '../hosts/mcp-config.js';
import { hasGraftIndex } from '../graph/root.js';
import type { PlannedWrite } from '../hosts/plan.js';

/**
 * The files `runInit` writes — pure, no writes, so `--dry-run` and the picker
 * can report them up front. All repo-local: the Claude Code layer never writes
 * outside the project.
 */
export function claudeTargets(dir: string): PlannedWrite[] {
  const t = (path: string, what: string, kind: PlannedWrite['kind'] = 'claude'): PlannedWrite =>
    ({ hostId: 'claude', id: 'claude', path, scope: 'repo', kind, what });
  return [
    t(join(dir, '.claude', 'settings.json'), 'graft statusline + hook blocks'),
    t(join(dir, '.claude', 'helpers', 'graft-statusline.cjs'), 'statusline shim'),
    t(join(dir, '.claude', 'helpers', 'graft-hooks.cjs'), 'hooks shim'),
    t(join(dir, '.claude', 'skills', 'graft', 'SKILL.md'), 'graft skill'),
    // Tagged 'mcp' so the picker doesn't label Claude Code as having no MCP.
    t(join(dir, '.mcp.json'), 'mcpServers.graft', 'mcp'),
  ];
}

/**
 * Build the graph if it isn't there yet. Not Claude-specific: the wiring for any
 * host points at `graft/`, so `graft init` builds whichever hosts were selected —
 * this lives beside `runInit` only because that's the caller that owns `built`.
 * Best-effort; the user can always run `graft build` (the epilogue says so).
 */
export function buildGraphIfMissing(dir: string, opts: { build?: boolean; cliPath?: string }): boolean {
  // `hasGraftIndex`, not just wiring.json: a workspace parent's graph IS its
  // `workspace.json` (nodes live in the children), so testing for wiring.json
  // alone would call it unbuilt and rebuild every child on each init.
  if (opts.build === false || !opts.cliPath || hasGraftIndex(dir)) return false;
  try {
    execFileSync(process.execPath, [opts.cliPath, 'build', '.'], { cwd: dir, stdio: 'inherit', timeout: 300000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Write only when the bytes actually differ.
 *
 * `runInit` is not just an explicit `graft init` any more: the version stamp lives
 * under the git-ignored `graft/.cache/`, so every fresh clone looks unstamped and
 * the session-start hook re-runs these writes on the first session. The files it
 * rewrites (`settings.json`, both shims, `SKILL.md`) ARE committed — the epilogue
 * tells people to `git add .claude` — so an unconditional write handed every
 * colleague a dirty working tree before they had typed anything. Same bytes, same
 * mtime, no diff.
 */
function writeIfChanged(path: string, content: string): boolean {
  try { if (readFileSync(path, 'utf8') === content) return false; } catch { /* absent or unreadable → write */ }
  writeFileSync(path, content);
  return true;
}

/**
 * The settings object to merge into: `{}` when there is no file, the parsed object
 * when there is one, and the sentinel `'unparseable'` when a file exists but graft
 * cannot read it — the one case where the only safe move is to write nothing.
 *
 * A non-object at the top level (`[]`, `"x"`, `null`) counts as unparseable too:
 * spreading one into the merge produces a settings.json Claude Code cannot load,
 * which is the same data loss by another route.
 */
function readSettings(path: string): Record<string, any> | 'unparseable' {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, 'utf8')); } catch { return 'unparseable'; }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return 'unparseable';
  return parsed as Record<string, any>;
}

/**
 * What to bake into the shims as their primary candidate.
 *
 * Absolute for a normal install — that is the whole point, the shims find graft
 * with zero guesswork. But when graft's own `dist/claude` sits INSIDE the repo
 * being wired (running `graft init` in a graft checkout), an absolute path is one
 * developer's home directory committed into `.claude/helpers/*.cjs` for everyone
 * else to pull: exactly the scar `hosts/mcp-config.ts` refuses to repeat for the
 * MCP launcher. A repo-relative path is identical on every machine, and the shim
 * resolves it against `CLAUDE_PROJECT_DIR` at runtime.
 */
export function bakedRef(dir: string): string {
  const dist = claudeDistDir();
  const rel = relative(resolve(dir), dist);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return dist;
  return rel.split(sep).join('/'); // posix separators: the same shim text on both platforms
}

export interface InitResult {
  settingsPath: string;
  shims: string[];
  skill: string;
  /** the `.mcp.json` write registering the graft MCP server for Claude Code. */
  mcp: McpWrite;
  warnings: string[];
  built: boolean;
  /** The `permissions.allow` entries this run proposed for `.claude/settings.json`,
   * for the caller to record in the wiring stamp — that record is what stops the
   * NEXT init from re-adding a grant the user deleted. Empty when settings.json was
   * left untouched (unparseable), because then nothing was proposed at all. */
  offeredAllow: string[];
}

export function runInit(dir: string, opts: { build?: boolean; cliPath?: string } = {}): InitResult {
  // Same list `--dry-run` and the picker report, so the two can't drift apart.
  const [settings, statusline, hooks, skill, mcpTarget] = claudeTargets(dir).map((t) => t.path);

  mkdirSync(dirname(statusline), { recursive: true });

  const settingsPath = settings;
  const warnings: string[] = [];
  // An existing settings.json that does not parse is the user's file with a typo in
  // it — a BOM, a trailing comma, a `//` comment — not an absent file. Treating the
  // two the same meant `{}` went into the merge and the write below replaced their
  // permissions, env, model, hooks and statusLine with graft's defaults, with no
  // backup and no way back. The other hosts already refuse this write
  // (`mergeJsonKey` → 'skipped-unparseable'); so does this one now.
  const existing = readSettings(settingsPath);
  let offeredAllow: string[] = [];
  if (existing === 'unparseable') {
    warnings.push(`${settingsPath} is not valid JSON — left untouched. Fix it (or move it aside) and re-run \`graft init\`; the graft statusline and hooks stay unwired until then.`);
  } else {
    // What a previous init here already proposed. Read from the stamp/memo rather
    // than inferred from the file, because "absent" alone cannot tell a grant the
    // user deleted from one this graft version has simply never offered.
    const merged = mergeGraftSettings(existing, { offeredBefore: priorAllowOffers(dir) });
    warnings.push(...merged.warnings);
    offeredAllow = merged.offeredAllow;
    writeIfChanged(settingsPath, `${JSON.stringify(merged.merged, null, 2)}\n`);
  }

  const sl = statusline;
  const hk = hooks;
  const baked = bakedRef(dir); // <pkg>/dist/claude — the shims' primary resolution candidate
  writeIfChanged(sl, statuslineShim(baked)); chmodSync(sl, 0o755);
  writeIfChanged(hk, hooksShim(baked)); chmodSync(hk, 0o755);

  // Install the graft skill — the piece that redirects the agent to graft/ before it
  // greps source. Overwritten each run (graft owns this file), like the shims above.
  const skillPath = skill;
  mkdirSync(dirname(skillPath), { recursive: true });
  writeIfChanged(skillPath, skillTemplate());

  // Register the graft MCP server in the project's .mcp.json so Claude Code
  // exposes graft_find_code/graft_trace_calls/etc. as tools — the same keyed merge the
  // other hosts use (existing servers preserved; unparseable files skipped).
  const mcp = mergeJsonKey('claude', mcpTarget, 'mcpServers', serverEntry());

  const built = buildGraphIfMissing(dir, opts);
  return { settingsPath, shims: [sl, hk], skill: skillPath, mcp, warnings, built, offeredAllow };
}
