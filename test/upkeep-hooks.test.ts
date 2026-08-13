/**
 * The session-start hook's self-maintenance pass, end to end: it must refresh
 * wiring an older graft wrote, surface a cached upgrade nudge, and — critically —
 * never touch the network, because it runs inside Claude Code's hook timeout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/claude/hooks.js';
import { readStamp, runningVersion, updateCachePath } from '../src/upkeep.js';
import { tmpRepo } from './helpers.js';

/** A repo that looks like a previous `graft init` ran here, with no stamp — i.e.
 * wired by a graft old enough not to have written one. */
function wiredRepo(tag: string): string {
  const repo = tmpRepo(tag);
  mkdirSync(join(repo, '.claude', 'helpers'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'helpers', 'graft-hooks.cjs'), '// wired by an old graft\n');
  return repo;
}

/** A fake home carrying a pre-populated update cache, so nothing has to fetch. */
function homeWithCache(tag: string, latest: string | null, ageMs = 0): string {
  const home = tmpRepo(tag);
  writeFileSync(
    (mkdirSync(join(home, '.graft'), { recursive: true }), updateCachePath(home)),
    JSON.stringify({ latest, checkedAt: Date.now() - ageMs }),
  );
  return home;
}

/** Runs the hook in-process with stdin/home/project-dir stubbed, returns stdout. */
async function runHook(event: string, repo: string, home: string): Promise<string> {
  const saved = {
    write: process.stdout.write,
    stdin: process.env.GRAFT_TEST_STDIN,
    home: process.env.HOME,
    profile: process.env.USERPROFILE,
    dir: process.env.CLAUDE_PROJECT_DIR,
  };
  let out = '';
  process.stdout.write = ((chunk: string) => { out += chunk; return true; }) as typeof process.stdout.write;
  process.env.GRAFT_TEST_STDIN = JSON.stringify({ cwd: repo, session_id: 'test' });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.CLAUDE_PROJECT_DIR = repo;
  try {
    await main(event);
  } finally {
    process.stdout.write = saved.write;
    if (saved.stdin === undefined) delete process.env.GRAFT_TEST_STDIN; else process.env.GRAFT_TEST_STDIN = saved.stdin;
    if (saved.home === undefined) delete process.env.HOME; else process.env.HOME = saved.home;
    if (saved.profile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = saved.profile;
    if (saved.dir === undefined) delete process.env.CLAUDE_PROJECT_DIR; else process.env.CLAUDE_PROJECT_DIR = saved.dir;
  }
  return out;
}

function contextOf(stdout: string): string {
  if (!stdout) return '';
  return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
}

test('session-start refreshes stale wiring and stamps it', async () => {
  const repo = wiredRepo('hook-refresh');
  const ctx = contextOf(await runHook('session-start', repo, homeWithCache('hook-refresh-home', null)));

  assert.match(ctx, /refreshed this repo's agent wiring/);
  assert.match(ctx, /written by unwired, now /);
  // The wiring was actually re-written, not just announced.
  assert.ok(existsSync(join(repo, '.claude', 'settings.json')));
  assert.ok(existsSync(join(repo, '.claude', 'skills', 'graft', 'SKILL.md')));
  assert.equal(readStamp(repo)?.version, runningVersion());
  assert.deepEqual(readStamp(repo)?.hosts, ['claude']);
});

test('a settings.json the refresh cannot parse is kept, and the user is told', async () => {
  // This path, not `graft init`, is how most repos get re-inited — so a warning
  // only the CLI printed would never reach the one person who needs it. And the
  // file itself: an unparseable settings.json used to be treated as an absent one
  // and replaced outright, taking the user's model, env and permissions with it.
  const repo = wiredRepo('hook-badsettings');
  const settings = join(repo, '.claude', 'settings.json');
  const original = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls)"] },\n}\n'; // trailing comma
  writeFileSync(settings, original);

  const ctx = contextOf(await runHook('session-start', repo, homeWithCache('hook-badsettings-home', null)));
  assert.match(ctx, /not valid JSON/);
  assert.equal(readFileSync(settings, 'utf8'), original, 'and it is still their file');
});

test('session-start says nothing on a second run — the stamp now matches', async () => {
  const repo = wiredRepo('hook-idempotent');
  const home = homeWithCache('hook-idempotent-home', null);
  await runHook('session-start', repo, home);
  const ctx = contextOf(await runHook('session-start', repo, home));
  assert.doesNotMatch(ctx, /refreshed this repo's agent wiring/);
});

test('session-start surfaces a cached upgrade nudge', async () => {
  const repo = wiredRepo('hook-nudge');
  const ctx = contextOf(await runHook('session-start', repo, homeWithCache('hook-nudge-home', '99.0.0')));
  assert.match(ctx, /graft .* → 99\.0\.0 available/);
  assert.match(ctx, /npm i -g @nanonets\/graft@latest/);
});

test('an up-to-date install gets no nudge', async () => {
  const repo = wiredRepo('hook-current');
  const ctx = contextOf(await runHook('session-start', repo, homeWithCache('hook-current-home', runningVersion())));
  assert.doesNotMatch(ctx, /available: run/);
});

test('a stale cache is used as-is: the hook never fetches', async () => {
  // Two days old — the CLI and the MCP server refresh this, never the hook: a
  // hook that shelled out to `npm view` would spend its whole timeout on it.
  const repo = wiredRepo('hook-stale-cache');
  const home = homeWithCache('hook-stale-home', '99.0.0', 2 * 24 * 60 * 60 * 1000);
  const before = Date.now();
  const ctx = contextOf(await runHook('session-start', repo, home));
  assert.match(ctx, /99\.0\.0 available/, 'stale answer still shown rather than refetched');
  assert.ok(Date.now() - before < 2000, 'no network round trip');
});

test('an unwired repo is left completely alone', async () => {
  const repo = tmpRepo('hook-unwired');
  const out = await runHook('session-start', repo, homeWithCache('hook-unwired-home', null));
  assert.equal(out, '', 'no INDEX.md, no wiring, nothing to say');
  assert.equal(existsSync(join(repo, '.claude')), false, 'never wires a repo that was not wired');
});

test('a nudge still lands in a wired repo with no graph built yet', async () => {
  const repo = wiredRepo('hook-nograph');
  const ctx = contextOf(await runHook('session-start', repo, homeWithCache('hook-nograph-home', '99.0.0')));
  assert.match(ctx, /99\.0\.0 available/, 'the no-INDEX.md path still reports upkeep');
});
