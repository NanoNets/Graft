import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_WIRING_OPTS,
  UPDATE_TTL_MS,
  compareVersions,
  formatUpdateNudge,
  formatWiringRefresh,
  isNewer,
  needsRefresh,
  readStamp,
  readWiringMemo,
  reconcileWiring,
  refreshOpts,
  runningVersion,
  stampPath,
  updateCachePath,
  wiredHostIds,
  wiringMemoPath,
  wiringOpts,
  writeStamp,
  type WiringOpts,
} from '../src/upkeep.js';
import { tmpRepo, rmDir } from './helpers.js';

/** Scratch home for the machine-global half of the stamp, so no test writes the
 * real `~/.graft/wiring/`. Shared: the memo is keyed by repo path, and every test
 * below builds its own repo. */
const HOME = tmpRepo('upkeep-home');

test('compareVersions orders releases numerically, not lexically', () => {
  assert.equal(compareVersions('0.9.1', '0.10.0'), -1); // the lexical trap
  assert.equal(compareVersions('0.10.0', '0.9.1'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  // Release part only: a prerelease of the same release compares equal, so it
  // never produces a nudge in either direction.
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0'), 0);
  // Missing segments are zeros, and garbage degrades to 0 rather than NaN.
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('x.y.z', '0.0.0'), 0);
});

test('isNewer only fires on a strictly greater candidate', () => {
  assert.equal(isNewer('0.10.0', '0.9.1'), true);
  assert.equal(isNewer('0.9.1', '0.9.1'), false);
  assert.equal(isNewer('0.9.0', '0.9.1'), false);
  assert.equal(isNewer(null, '0.9.1'), false); // failed fetch
  assert.equal(isNewer(undefined, '0.9.1'), false); // no cache yet
});

test('formatUpdateNudge stays silent unless there is something to say', () => {
  assert.equal(formatUpdateNudge('0.9.1', '0.9.1'), null);
  assert.equal(formatUpdateNudge('0.9.1', null), null);
  const line = formatUpdateNudge('0.9.1', '0.11.0');
  assert.ok(line);
  assert.match(line, /0\.9\.1 → 0\.11\.0/);
  assert.match(line, /npm i -g @nanonets\/graft@latest/);
  assert.equal(line.split('\n').length, 1, 'one line — this rides in an agent context window');
});

test('needsRefresh treats a missing or malformed cache as stale', () => {
  const now = 1_700_000_000_000;
  assert.equal(needsRefresh(null, now), true);
  assert.equal(needsRefresh({ latest: '1.0.0', checkedAt: undefined as unknown as number }, now), true);
  assert.equal(needsRefresh({ latest: '1.0.0', checkedAt: now }, now), false);
  assert.equal(needsRefresh({ latest: '1.0.0', checkedAt: now - UPDATE_TTL_MS + 1 }, now), false);
  assert.equal(needsRefresh({ latest: '1.0.0', checkedAt: now - UPDATE_TTL_MS }, now), true);
});

test('the update cache is machine-global, not per-repo', () => {
  // One dev with twelve repos should cost the registry one request a day.
  assert.equal(updateCachePath('/home/dev'), join('/home/dev', '.graft', 'update-check.json'));
});

test('runningVersion resolves this package, not the caller depth', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  assert.equal(runningVersion(), pkg.version);
});

test('the stamp round-trips under graft/.cache/', () => {
  const repo = tmpRepo('upkeep-stamp');
  assert.equal(readStamp(repo), null);
  writeStamp(repo, '1.2.3', ['cursor', 'claude'], {}, '2026-01-01T00:00:00.000Z', HOME);
  assert.equal(stampPath(repo), join(repo, 'graft', '.cache', 'wiring-stamp.json'));
  assert.deepEqual(readStamp(repo), {
    version: '1.2.3',
    hosts: ['claude', 'cursor'], // sorted, so two inits in different picker order match
    opts: { global: true, mcp: true, hooks: true },
    at: '2026-01-01T00:00:00.000Z',
  });
});

test('wiringOpts defaults an older stamp to what plain `graft init` does', () => {
  assert.deepEqual(wiringOpts(null), DEFAULT_WIRING_OPTS);
  // A stamp written before flags were recorded: assume the full wiring.
  assert.deepEqual(wiringOpts({ version: '1.0.0', hosts: ['claude'], at: 'x' }), DEFAULT_WIRING_OPTS);
  // A partial record still fills the gaps.
  assert.deepEqual(
    wiringOpts({ version: '1.0.0', hosts: ['claude'], at: 'x', opts: { global: false } }),
    { global: false, mcp: true, hooks: true },
  );
});

test('a refresh replays the flags init was given, including --no-global', () => {
  const repo = tmpRepo('upkeep-replay');
  writeStamp(repo, '1.0.0', ['agents'], { global: false, hooks: false }, undefined, HOME);
  let seen: WiringOpts | null = null;
  const r = reconcileWiring(repo, '2.0.0', {
    wired: () => ['agents'],
    rewrite: (_repo, _hosts, opts) => { seen = opts; },
    home: HOME,
  });
  // The user said "keep out of ~/.codex" — a later session must not overrule that.
  assert.deepEqual(seen, { global: false, mcp: true, hooks: false });
  assert.equal(r?.global, false);
  assert.deepEqual(readStamp(repo)?.opts, { global: false, mcp: true, hooks: false }, 'and it stays recorded');
});

test('by default a refresh DOES reach ~/.codex — nothing else ever would', () => {
  // No skill, rule file, or MCP instruction tells an agent to run `graft init`,
  // so skipping the out-of-repo writes means a Codex user never gets them.
  const repo = tmpRepo('upkeep-global');
  writeStamp(repo, '1.0.0', ['agents'], {}, undefined, HOME);
  let seen: WiringOpts | null = null;
  const r = reconcileWiring(repo, '2.0.0', {
    wired: () => ['agents'],
    rewrite: (_repo, _hosts, opts) => { seen = opts; },
    home: HOME,
  });
  assert.deepEqual(seen, DEFAULT_WIRING_OPTS);
  assert.equal(r?.global, true);
});

test('the memo keeps the flags outside the repo, keyed per repo', () => {
  const repo = tmpRepo('upkeep-memo-path');
  const p = wiringMemoPath(repo, '/home/dev');
  assert.ok(p.startsWith(join('/home/dev', '.graft', 'wiring')), `outside the repo: ${p}`);
  assert.notEqual(p, wiringMemoPath(tmpRepo('upkeep-memo-path2'), '/home/dev'), 'one file per repo');
  // Same repo, same file — a trailing separator is not a different project.
  assert.equal(wiringMemoPath(`${repo}/`, '/home/dev'), p);
});

test('refreshOpts: a record means replay, no record means stay inside the repo', () => {
  assert.deepEqual(refreshOpts({ version: '1', hosts: [], at: 'x', opts: { global: false } }, null),
    { global: false, mcp: true, hooks: true });
  // A stamp with no opts predates the flags: init did run here, wiring everything.
  assert.deepEqual(refreshOpts({ version: '1', hosts: [], at: 'x' }, null), DEFAULT_WIRING_OPTS);
  // No stamp, but the machine remembers the init: replay what it chose.
  assert.deepEqual(refreshOpts(null, { repo: '/r', at: 'x', opts: { global: false, hooks: false } }),
    { global: false, mcp: true, hooks: false });
  // Nothing anywhere: repo-local, plus out-of-repo entries that ALREADY name graft.
  // A flat `global: false` here also abandoned every install predating the stamp —
  // those users did run `graft init`, and nothing else ever refreshes ~/.codex.
  assert.deepEqual(refreshOpts(null, null), { global: 'if-present', mcp: true, hooks: true });
});

test('--no-global survives graft/ being deleted — every fresh clone is that case', () => {
  const repo = tmpRepo('upkeep-memo');
  writeStamp(repo, '1.0.0', ['agents'], { global: false }, undefined, HOME);
  assert.deepEqual(readWiringMemo(repo, HOME)?.opts, { global: false, mcp: true, hooks: true });

  // graft/ is git-ignored, so this is also what every colleague's clone looks like.
  rmDir(join(repo, 'graft'));
  assert.equal(readStamp(repo), null);

  let seen: WiringOpts | null = null;
  reconcileWiring(repo, '2.0.0', {
    wired: () => ['agents'],
    rewrite: (_repo, _hosts, opts) => { seen = opts; },
    home: HOME,
  });
  assert.deepEqual(seen, { global: false, mcp: true, hooks: true }, 'the opt-out outlived the cache dir');
});

test('an unsolicited refresh never CREATES machine-wide config', () => {
  // Committed wiring (`git add .claude`, says the epilogue) plus a git-ignored
  // graft/ means the first session in a fresh clone looks unstamped. Refreshing the
  // repo's own files there is maintenance; installing graft's hooks into
  // ~/.codex/hooks.json — read by every Codex project on the machine — for someone
  // who never ran `graft init` is not. 'if-present' is exactly that line: entries
  // that already name graft are the user's own earlier yes and stay current
  // (installCodexHooks/registerMcpConfigs enforce it); nothing new is created.
  const repo = tmpRepo('upkeep-unsolicited');
  const home = tmpRepo('upkeep-unsolicited-home');
  let seen: WiringOpts | null = null;
  const r = reconcileWiring(repo, '2.0.0', {
    wired: () => ['agents', 'claude'],
    rewrite: (_repo, _hosts, opts) => { seen = opts; },
    home,
  });
  assert.deepEqual(seen, { global: 'if-present', mcp: true, hooks: true });
  assert.equal(r?.global, 'if-present');
  assert.deepEqual(r?.hosts, ['agents', 'claude'], 'the repo-local wiring is still brought up to date');
});

test('wiredHostIds reads what init actually wrote, not what the machine has', () => {
  const repo = tmpRepo('upkeep-wired');
  assert.deepEqual(wiredHostIds(repo), [], 'unwired repo');

  mkdirSync(join(repo, '.claude', 'helpers'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'helpers', 'graft-hooks.cjs'), '// shim');
  mkdirSync(join(repo, '.cursor', 'rules'), { recursive: true });
  writeFileSync(join(repo, '.cursor', 'rules', 'graft.mdc'), 'rule');
  // A shared file graft does NOT own: present, but no fenced graft section.
  writeFileSync(join(repo, 'AGENTS.md'), '# my own notes\n');

  const ids = wiredHostIds(repo);
  assert.ok(ids.includes('claude'));
  assert.ok(ids.includes('cursor'));
  assert.ok(!ids.includes('agents'), "a user's own AGENTS.md is not graft wiring");

  writeFileSync(join(repo, 'AGENTS.md'), '# my own notes\n\n<!-- graft:start -->\nx\n<!-- graft:end -->\n');
  assert.ok(wiredHostIds(repo).includes('agents'), 'the fenced section makes it ours');
});

test('reconcileWiring rewrites once on a version mismatch, then no-ops', () => {
  const repo = tmpRepo('upkeep-reconcile');
  const calls: string[][] = [];
  const rewrite = (_r: string, hosts: string[]) => { calls.push(hosts); };
  const wired = () => ['claude', 'cursor'];
  const deps = { wired, rewrite, home: HOME };

  // No stamp and no memo (a fresh clone of a repo whose wiring was committed) →
  // refresh the repo, and out-of-repo only where graft is already registered:
  // nobody asked this machine to install anything new.
  const first = reconcileWiring(repo, '2.0.0', deps);
  assert.deepEqual(first, { from: 'unwired', to: '2.0.0', hosts: ['claude', 'cursor'], global: 'if-present' });
  assert.deepEqual(calls, [['claude', 'cursor']]);

  // Stamp now matches the running binary → nothing happens on every later session.
  assert.equal(reconcileWiring(repo, '2.0.0', deps), null);
  assert.equal(calls.length, 1, 'idempotent: no rewrite per session');

  // A newer binary → one more refresh, reported with the version it came from.
  const upgraded = reconcileWiring(repo, '2.1.0', deps);
  assert.deepEqual(upgraded, { from: '2.0.0', to: '2.1.0', hosts: ['claude', 'cursor'], global: 'if-present' });
  assert.equal(calls.length, 2);
  assert.equal(readStamp(repo)?.version, '2.1.0');
});

test('reconcileWiring restores a host whose file went missing', () => {
  // The whole point of a refresh is putting the wiring back. Detecting hosts from
  // disk alone would drop the one host whose file is gone — the one that needs it.
  const repo = tmpRepo('upkeep-restore');
  writeStamp(repo, '1.0.0', ['claude', 'cursor'], {}, undefined, HOME);
  const calls: string[][] = [];
  const r = reconcileWiring(repo, '2.0.0', {
    wired: () => ['claude'], // cursor's graft.mdc is no longer on disk
    rewrite: (_repo, hosts) => { calls.push(hosts); },
    home: HOME,
  });
  assert.deepEqual(r?.hosts, ['claude', 'cursor']);
  assert.deepEqual(calls, [['claude', 'cursor']]);
  assert.deepEqual(readStamp(repo)?.hosts, ['claude', 'cursor'], 'intent survives the refresh');
});

test('reconcileWiring adopts a host added since the stamp was written', () => {
  const repo = tmpRepo('upkeep-adopt');
  writeStamp(repo, '1.0.0', ['claude'], {}, undefined, HOME);
  const r = reconcileWiring(repo, '2.0.0', { wired: () => ['claude', 'windsurf'], rewrite: () => {}, home: HOME });
  assert.deepEqual(r?.hosts, ['claude', 'windsurf']);
});

test('reconcileWiring leaves a repo that graft never wired alone', () => {
  const repo = tmpRepo('upkeep-unwired');
  let rewrote = false;
  const r = reconcileWiring(repo, '2.0.0', { wired: () => [], rewrite: () => { rewrote = true; }, home: HOME });
  assert.equal(r, null);
  assert.equal(rewrote, false);
  assert.equal(existsSync(stampPath(repo)), false, 'no stamp written for a repo we do not manage');
});

test('reconcileWiring never throws out into a hook', () => {
  const repo = tmpRepo('upkeep-throws');
  const r = reconcileWiring(repo, '2.0.0', {
    wired: () => ['claude'],
    rewrite: () => { throw new Error('disk full'); },
    home: HOME,
  });
  assert.equal(r, null, 'a failed refresh is silent, not a broken session');
});

test('formatWiringRefresh names the versions and the hosts touched', () => {
  assert.equal(formatWiringRefresh(null), null);
  const line = formatWiringRefresh({ from: '0.7.0', to: '0.11.0', hosts: ['claude', 'cursor'], global: true });
  assert.ok(line);
  assert.match(line, /0\.7\.0/);
  assert.match(line, /0\.11\.0/);
  assert.match(line, /claude, cursor/);
  // Repo-local hosts only: nothing outside the repo moved, so don't claim it did.
  assert.doesNotMatch(line, /~\/\.codex/);
});

test('formatWiringRefresh discloses machine-wide writes', () => {
  const global = formatWiringRefresh({ from: '0.7.0', to: '0.11.0', hosts: ['agents'], global: true });
  assert.ok(global);
  assert.match(global, /~\/\.codex/, 'a session changing shared config must say so');

  const local = formatWiringRefresh({ from: '0.7.0', to: '0.11.0', hosts: ['agents'], global: false });
  assert.ok(local);
  assert.doesNotMatch(local, /~\/\.codex/);
});
