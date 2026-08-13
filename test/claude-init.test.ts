import { test } from 'node:test';
import assert from 'node:assert/strict';

// The MCP launch command is resolved from PATH at init time; pin it to the npx
// form so these expectations are the same on every machine.
process.env.GRAFT_MCP_NPX = '1';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { bakedRef, buildGraphIfMissing, runInit } from '../src/claude/init.js';
import { formatInitEpilogue } from '../src/cli-epilogue.js';
import { writeStamp } from '../src/upkeep.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-init-')); }

function runPostinstall(env: Record<string, string>): string {
  try {
    return execFileSync(process.execPath, ['scripts/postinstall.mjs'],
      { encoding: 'utf8', env: { ...process.env, ...env } });
  } catch { return ''; }
}

test('runInit scaffolds settings + both shims + the skill (build skipped)', () => {
  const d = fresh();
  const r = runInit(d, { build: false });
  assert.ok(existsSync(join(d, '.claude', 'settings.json')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-statusline.cjs')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-hooks.cjs')));
  const skillPath = join(d, '.claude', 'skills', 'graft', 'SKILL.md');
  assert.ok(existsSync(skillPath), 'writes the graft skill');
  assert.equal(r.skill, skillPath);
  assert.match(readFileSync(skillPath, 'utf8'), /name: graft/);
  assert.equal(r.built, false);
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.statusLine.command.includes('graft-statusline.cjs'));
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('graft-hooks.cjs'));
  assert.deepEqual(s.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('runInit overwrites a stale skill file', () => {
  const d = fresh();
  const skillPath = join(d, '.claude', 'skills', 'graft', 'SKILL.md');
  mkdirSync(join(d, '.claude', 'skills', 'graft'), { recursive: true });
  writeFileSync(skillPath, 'stale junk');
  runInit(d, { build: false });
  assert.match(readFileSync(skillPath, 'utf8'), /name: graft/);
});

test('runInit preserves foreign settings and warns on foreign statusLine', () => {
  const d = fresh();
  mkdirSync(join(d, '.claude'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ model: 'x', statusLine: { command: 'mine' } }));
  const r = runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.model, 'x');
  assert.equal(s.statusLine.command, 'mine');
  assert.equal(r.warnings.length, 1);
});

test('runInit is idempotent', () => {
  const d = fresh();
  runInit(d, { build: false });
  runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.equal(s.hooks.PostToolUse.length, 2); // post-edit + tool-savings, not duplicated on re-init
  assert.deepEqual(s.permissions.allow, ['Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

test('runInit appends the allowlist to a pre-existing permissions block, preserving unrelated entries', () => {
  const d = fresh();
  mkdirSync(join(d, '.claude'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(s.permissions.allow, ['Bash(ls)', 'Bash(graft:*)', 'Bash(npx -y @nanonets/graft:*)', 'Bash(graft-dev:*)', 'Bash(node dist/cli.js:*)']);
});

// --- a settings.json graft cannot read is the user's file, not an absent one ----

/** The four repo files runInit owns, in write order. */
function ownedFiles(d: string): string[] {
  return [
    join(d, '.claude', 'settings.json'),
    join(d, '.claude', 'helpers', 'graft-statusline.cjs'),
    join(d, '.claude', 'helpers', 'graft-hooks.cjs'),
    join(d, '.claude', 'skills', 'graft', 'SKILL.md'),
  ];
}

test('an unparseable settings.json is left byte-for-byte alone, with a warning', () => {
  const d = fresh();
  mkdirSync(join(d, '.claude'), { recursive: true });
  const p = join(d, '.claude', 'settings.json');
  // A `//` comment — the single most common way a hand-edited settings.json stops
  // parsing. Before the guard this whole file was replaced by graft's defaults.
  const original = '{\n  "model": "opus",\n  // graft cannot parse this\n  "permissions": { "allow": ["Bash(ls)"] }\n}\n';
  writeFileSync(p, original);

  const r = runInit(d, { build: false });
  assert.equal(readFileSync(p, 'utf8'), original, "the user's settings survived");
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not valid JSON/);
  // The rest of init still runs: the shims and the skill are graft's own files.
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-hooks.cjs')));
});

test('a settings.json holding a non-object is refused too', () => {
  const d = fresh();
  mkdirSync(join(d, '.claude'), { recursive: true });
  const p = join(d, '.claude', 'settings.json');
  writeFileSync(p, '["not", "an", "object"]');
  const r = runInit(d, { build: false });
  assert.equal(readFileSync(p, 'utf8'), '["not", "an", "object"]');
  assert.match(r.warnings[0], /not valid JSON/);
});

test('re-init rewrites nothing when nothing changed — a fresh clone must not go dirty', () => {
  // The stamp that decides whether to refresh lives under the git-ignored
  // graft/.cache/, so every clone looks unwired and the session-start hook re-runs
  // these writes. The files are committed, so an unconditional write handed each
  // colleague a diff in `.claude/` before they typed anything.
  const d = fresh();
  runInit(d, { build: false });
  const stale = new Date(Date.now() - 60_000);
  for (const f of ownedFiles(d)) utimesSync(f, stale, stale);

  runInit(d, { build: false });
  for (const f of ownedFiles(d))
    assert.ok(statSync(f).mtimeMs < Date.now() - 30_000, `${f} was rewritten with identical content`);
});

test('a changed file is still rewritten', () => {
  const d = fresh();
  runInit(d, { build: false });
  const skill = join(d, '.claude', 'skills', 'graft', 'SKILL.md');
  writeFileSync(skill, 'clobbered by hand');
  runInit(d, { build: false });
  assert.match(readFileSync(skill, 'utf8'), /name: graft/);
});

test('bakedRef is repo-relative inside graft\'s own checkout, absolute anywhere else', () => {
  // Absolute is right for a consumer repo — the shim then needs no guesswork. It is
  // wrong for graft's own checkout: the path would be one developer's home
  // directory, committed into .claude/helpers/*.cjs for everyone else to pull.
  const graftCheckout = fileURLToPath(new URL('..', import.meta.url));
  const ref = bakedRef(graftCheckout);
  assert.ok(!isAbsolute(ref), `expected a relative ref inside the checkout, got ${ref}`);
  assert.doesNotMatch(ref, /\\/, 'posix separators, so the committed shim is identical on both platforms');
  assert.ok(isAbsolute(bakedRef(fresh())), 'a consumer repo still gets the absolute install path');
});

test('postinstall prints the nudge in a fresh dir, naming the scoped package', () => {
  const d = fresh();
  const out = runPostinstall({ INIT_CWD: d, CI: '' });
  assert.match(out, /npx -y @nanonets\/graft init/);
  // Bare `npx graft` resolves to a different author's package on the registry. The
  // allowlist stopped granting that form; the line users actually copy has to stop
  // printing it too.
  assert.doesNotMatch(out, /npx graft /);
});

test('postinstall is silent when already initialized', () => {
  const d = fresh();
  runInit(d, { build: false });
  const out = runPostinstall({ INIT_CWD: d, CI: '' });
  assert.equal(out.trim(), '');
});

test('postinstall is silent under CI', () => {
  const out = runPostinstall({ INIT_CWD: fresh(), CI: '1' });
  assert.equal(out.trim(), '');
});

test('formatInitEpilogue: graph built shows stats, wordmark, and the 3-step list', () => {
  const out = formatInitEpilogue({ graphBuilt: true, nodes: 6398, edges: 10912 });
  assert.match(out, /\|___\/\s*$/m);
  assert.ok(out.includes('6,398 nodes · 10,912 edges'));
  assert.ok(out.includes('1. restart your agent'));
  assert.ok(out.includes('2. code as usual'));
  assert.ok(out.includes('3. explore by hand'));
  assert.ok(out.includes('graft ask'));
  assert.ok(!out.includes('build the graph'));
  assert.ok(!out.includes('OPENROUTER'));
  // graft/ is git-ignored now — the shareable artifact is .claude (wiring), not the graph.
  assert.ok(out.includes('git add .claude'));
});

test('formatInitEpilogue: graph not built shows "build the graph" as step 1, no stats, same column alignment', () => {
  const built = formatInitEpilogue({ graphBuilt: true, nodes: 4, edges: 4 });
  const notBuilt = formatInitEpilogue({ graphBuilt: false });
  assert.ok(notBuilt.includes('1. build the graph'));
  assert.ok(notBuilt.includes('2. restart your agent'));
  assert.ok(notBuilt.includes('3. code as usual'));
  assert.ok(notBuilt.includes('4. explore by hand'));
  assert.ok(!notBuilt.includes('nodes ·'));
  assert.ok(notBuilt.includes('git add .claude'));
  // the command column (after "restart your agent", the longest label) lines up
  // identically whether there are 3 or 4 numbered steps.
  const col = (text: string, marker: string) => text.split('\n').find((l) => l.includes(marker))!.indexOf('a new session');
  assert.equal(col(built, 'restart your agent'), col(notBuilt, 'restart your agent'));
});

test('CLI: graft init epilogue has the wordmark + next steps, and never mentions OPENROUTER', () => {
  const d = fresh();
  const res = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/cli.ts', 'init', d, '--no-build', '--no-agents'],
    { encoding: 'utf8' },
  );
  assert.equal(res.status, 0, res.stderr);
  assert.ok(res.stderr.includes('|___/'), 'wordmark present');
  assert.ok(res.stderr.includes('code as usual'));
  assert.ok(res.stderr.includes('restart your agent'));
  assert.ok(res.stderr.includes('git add .claude'));
  assert.ok(res.stderr.includes('graft ask'));
  assert.ok(!res.stderr.includes('OPENROUTER'));
  // --no-build, never built before → "build the graph" is step 1
  assert.ok(res.stderr.includes('1. build the graph'));
});

// --- buildGraphIfMissing --------------------------------------------------
// Shared with the CLI's non-Claude path, so its guards are pinned here.

test('buildGraphIfMissing: build:false never spawns a build', () => {
  assert.equal(buildGraphIfMissing(fresh(), { build: false, cliPath: '/nonexistent/cli.js' }), false);
});

test('buildGraphIfMissing: no cliPath means nothing to spawn', () => {
  assert.equal(buildGraphIfMissing(fresh(), { build: true }), false);
});

test('buildGraphIfMissing: an existing graph is left alone', () => {
  const dir = fresh();
  mkdirSync(join(dir, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(dir, 'graft', '.graph', 'wiring.json'), '{}');
  // A bogus cliPath would throw if it were reached; the wiring check short-circuits.
  assert.equal(buildGraphIfMissing(dir, { build: true, cliPath: '/nonexistent/cli.js' }), false);
});

test('a permission the user removed is not reinstalled by the next init', () => {
  // End-to-end over the two halves this needs: `runInit` reports what it proposed,
  // the caller records it in the wiring stamp, and the next `runInit` reads it back.
  // Without the record, every version bump re-added the entry — into a committed
  // file, so the team got it back too, and the only recourse was deleting it again
  // after each upgrade.
  const d = fresh();
  const home = fresh();
  const settingsPath = join(d, '.claude', 'settings.json');
  const allowOf = () => JSON.parse(readFileSync(settingsPath, 'utf8')).permissions.allow as string[];

  const first = runInit(d, { build: false });
  assert.ok(allowOf().includes('Bash(graft-dev:*)'));
  assert.ok(first.offeredAllow.includes('Bash(graft-dev:*)'), 'the run reports what it proposed');
  writeStamp(d, '1.0.0', ['claude'], {}, undefined, home, first.offeredAllow);

  // The user deletes one grant by hand and commits that.
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
  settings.permissions.allow = settings.permissions.allow.filter((e: string) => e !== 'Bash(graft-dev:*)');
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  runInit(d, { build: false });
  assert.ok(!allowOf().includes('Bash(graft-dev:*)'), 'a deleted grant stays deleted');
  // The rest of the wiring is still maintained — this is a narrow rule about
  // permissions, not a reason to stop refreshing the file.
  assert.ok(allowOf().includes('Bash(graft:*)'));
  assert.ok(JSON.stringify(JSON.parse(readFileSync(settingsPath, 'utf8')).hooks).includes('graft-hooks.cjs'));
});
