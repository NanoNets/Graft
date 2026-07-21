import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runHostsInit } from '../src/hosts/init.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-hostsinit-')); }

test('writes only detected hosts by default', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.cursor'));
  const r = runHostsInit(repo, { home });
  assert.deepEqual(r.written.map((w) => w.id), ['cursor']);
  const mdc = readFileSync(join(repo, '.cursor', 'rules', 'graft.mdc'), 'utf8');
  assert.match(mdc, /alwaysApply: true/);
  assert.ok(!existsSync(join(repo, 'AGENTS.md')));
});

test('explicit agents list overrides detection and flags unknown ids', () => {
  const home = fresh(); const repo = fresh();
  const r = runHostsInit(repo, { home, agents: ['gemini', 'nope'] });
  assert.deepEqual(r.written.map((w) => w.id), ['gemini']);
  assert.deepEqual(r.unknown, ['nope']);
  assert.ok(readFileSync(join(repo, 'GEMINI.md'), 'utf8').includes('graft ask'));
});

test('all writes every host and re-run converges (idempotent)', () => {
  const home = fresh(); const repo = fresh();
  const first = runHostsInit(repo, { home, all: true });
  assert.equal(first.written.length, 6);
  const second = runHostsInit(repo, { home, all: true });
  assert.ok(second.written.every((w) => w.action === 'unchanged'));
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8');
  assert.equal(agents.match(/graft:start/g)!.length, 1);
});

test('preserves user content around the fenced section', () => {
  const home = fresh(); const repo = fresh();
  const target = join(repo, '.github', 'copilot-instructions.md');
  mkdirSync(join(repo, '.github'), { recursive: true });
  writeFileSync(target, '# House rules\n');
  const r = runHostsInit(repo, { home });
  assert.deepEqual(r.written.map((w) => w.id), ['copilot']);
  const text = readFileSync(target, 'utf8');
  assert.ok(text.startsWith('# House rules'));
  assert.ok(text.includes('graft ask'));
});

test('CLI: graft init --agents gemini writes GEMINI.md and exits 0', () => {
  const repo = fresh();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'gemini'], {
    encoding: 'utf8',
  });
  assert.ok(readFileSync(join(repo, 'GEMINI.md'), 'utf8').includes('graft ask'));
});

test('CLI: unknown agent id exits non-zero', () => {
  const repo = fresh();
  assert.throws(() =>
    execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'nope'], {
      encoding: 'utf8', stdio: 'pipe',
    }),
  );
});

test('explicit empty agents list writes nothing, even when home has agent dirs (no fallback to detection)', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.cursor'));
  const r = runHostsInit(repo, { home, agents: [] });
  assert.deepEqual(r.written, []);
  assert.ok(!existsSync(join(repo, '.cursor')));
});

test('CLI: --agents claude with --no-build writes .claude/ but no other-agent files', () => {
  const repo = fresh();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'claude'], {
    encoding: 'utf8',
  });
  assert.ok(existsSync(join(repo, '.claude')));
  assert.ok(!existsSync(join(repo, 'AGENTS.md')));
  assert.ok(!existsSync(join(repo, 'GEMINI.md')));
  assert.ok(!existsSync(join(repo, '.cursor')));
});

test('CLI: --agents claude gemini nope exits non-zero and leaves repo untouched (validation before writes)', () => {
  const repo = fresh();
  assert.throws(() =>
    execFileSync(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'claude', 'gemini', 'nope'],
      { encoding: 'utf8', stdio: 'pipe' },
    ),
  );
  assert.ok(!existsSync(join(repo, '.claude')));
  assert.ok(!existsSync(join(repo, 'GEMINI.md')));
  assert.ok(!existsSync(join(repo, 'AGENTS.md')));
});

test('runHostsInit registers MCP configs for selected hosts', () => {
  const home = fresh(); const repo = fresh();
  const r = runHostsInit(repo, { home, agents: ['cursor'] });
  assert.equal(r.mcp.length, 1);
  assert.match(r.mcp[0].path, /\.cursor\/mcp\.json$/);
  const cfg = JSON.parse(readFileSync(join(repo, '.cursor', 'mcp.json'), 'utf8'));
  assert.equal(cfg.mcpServers.graft.command, 'npx');
});

test('mcp: false skips MCP registration', () => {
  const home = fresh(); const repo = fresh();
  const r = runHostsInit(repo, { home, agents: ['cursor'], mcp: false });
  assert.deepEqual(r.mcp, []);
  assert.ok(!existsSync(join(repo, '.cursor', 'mcp.json')));
});

test('CLI: --no-mcp writes the rule file but no MCP config', () => {
  const repo = fresh();
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'init', repo, '--no-build', '--agents', 'cursor', '--no-mcp'], { encoding: 'utf8' });
  assert.ok(existsSync(join(repo, '.cursor', 'rules', 'graft.mdc')));
  assert.ok(!existsSync(join(repo, '.cursor', 'mcp.json')));
});

test('runHostsInit installs hooks for the agents id when the CLI home exists', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const r = runHostsInit(repo, { home, agents: ['agents'] });
  assert.equal(r.hooks.length, 2);
  assert.ok(existsSync(join(home, '.codex', 'hooks', 'graft', 'graft-hooks.cjs')));
});

test('hooks: false skips hook installation', () => {
  const home = fresh(); const repo = fresh();
  mkdirSync(join(home, '.codex'), { recursive: true });
  const r = runHostsInit(repo, { home, agents: ['agents'], hooks: false });
  assert.deepEqual(r.hooks, []);
  assert.ok(!existsSync(join(home, '.codex', 'hooks.json')));
});
