import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertSection, fencedBlock } from '../src/hosts/sections.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-sections-')); }

test('creates the file with a fenced block when missing', () => {
  const f = join(fresh(), 'AGENTS.md');
  const r = upsertSection(f, '## Graft\nuse graft ask');
  assert.equal(r.action, 'created');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('<!-- graft:start -->'));
  assert.ok(text.includes('use graft ask'));
  assert.ok(text.endsWith('\n'));
});

test('appends after existing content, separated by a blank line', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, '# My rules\n\nBe nice.\n');
  const r = upsertSection(f, 'graft body');
  assert.equal(r.action, 'appended');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.startsWith('# My rules\n\nBe nice.\n'));
  assert.match(text, /Be nice\.\n\n<!-- graft:start -->/);
});

test('replaces only the fenced region on re-run with new body', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, `above\n\n${fencedBlock('old body')}\nbelow\n`);
  const r = upsertSection(f, 'new body');
  assert.equal(r.action, 'replaced');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('above'));
  assert.ok(text.includes('below'));
  assert.ok(text.includes('new body'));
  assert.ok(!text.includes('old body'));
  assert.equal(text.match(/graft:start/g)!.length, 1, 'exactly one block');
});

test('reports unchanged when the fenced body already matches', () => {
  const f = join(fresh(), 'AGENTS.md');
  upsertSection(f, 'same body');
  const r = upsertSection(f, 'same body');
  assert.equal(r.action, 'unchanged');
});

test('ignores inline marker mentions (marker must be alone on its line)', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, 'talking about `<!-- graft:start -->` in prose\n');
  const r = upsertSection(f, 'body');
  assert.equal(r.action, 'appended');
  assert.equal(readFileSync(f, 'utf8').match(/^<!-- graft:start -->$/gm)!.length, 1);
});
