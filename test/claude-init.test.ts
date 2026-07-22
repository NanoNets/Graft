import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { runInit } from '../src/claude/init.js';
import { formatInitEpilogue } from '../src/cli-epilogue.js';

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
  assert.deepEqual(s.permissions.allow, ['Bash(graft:*)', 'Bash(npx graft:*)']);
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
  assert.equal(s.hooks.PostToolUse.length, 1);
  assert.deepEqual(s.permissions.allow, ['Bash(graft:*)', 'Bash(npx graft:*)']);
});

test('runInit appends the allowlist to a pre-existing permissions block, preserving unrelated entries', () => {
  const d = fresh();
  mkdirSync(join(d, '.claude'), { recursive: true });
  writeFileSync(join(d, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] } }));
  runInit(d, { build: false });
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(s.permissions.allow, ['Bash(ls)', 'Bash(graft:*)', 'Bash(npx graft:*)']);
});

test('postinstall prints the nudge in a fresh dir', () => {
  const d = fresh();
  const out = runPostinstall({ INIT_CWD: d, CI: '' });
  assert.match(out, /npx graft init/);
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
  assert.ok(out.includes('1. commit the map'));
  assert.ok(out.includes('2. restart your agent'));
  assert.ok(out.includes('3. try it'));
  assert.ok(out.includes('graft ask'));
  assert.ok(!out.includes('build the graph'));
  assert.ok(!out.includes('OPENROUTER'));
});

test('formatInitEpilogue: graph not built shows "build the graph" as step 1, no stats, same column alignment', () => {
  const built = formatInitEpilogue({ graphBuilt: true, nodes: 4, edges: 4 });
  const notBuilt = formatInitEpilogue({ graphBuilt: false });
  assert.ok(notBuilt.includes('1. build the graph'));
  assert.ok(notBuilt.includes('2. commit the map'));
  assert.ok(notBuilt.includes('3. restart your agent'));
  assert.ok(notBuilt.includes('4. try it'));
  assert.ok(!notBuilt.includes('nodes ·'));
  // the command column (after "restart your agent", the longest label) lines up
  // identically whether there are 3 or 4 numbered steps.
  const col = (text: string, marker: string) => text.split('\n').find((l) => l.includes(marker))!.indexOf('the next session');
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
  assert.ok(res.stderr.includes('commit the map'));
  assert.ok(res.stderr.includes('graft ask'));
  assert.ok(!res.stderr.includes('OPENROUTER'));
  // --no-build, never built before → "build the graph" is step 1
  assert.ok(res.stderr.includes('1. build the graph'));
});
