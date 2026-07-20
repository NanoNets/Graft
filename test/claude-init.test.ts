import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInit } from '../src/claude/init.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-init-')); }

test('runInit scaffolds settings + both shims (build skipped)', () => {
  const d = fresh();
  const r = runInit(d, { build: false });
  assert.ok(existsSync(join(d, '.claude', 'settings.json')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-statusline.cjs')));
  assert.ok(existsSync(join(d, '.claude', 'helpers', 'graft-hooks.cjs')));
  assert.equal(r.built, false);
  const s = JSON.parse(readFileSync(join(d, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.statusLine.command.includes('graft-statusline.cjs'));
  assert.ok(s.hooks.Stop[0].hooks[0].command.includes('graft-hooks.cjs'));
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
});
