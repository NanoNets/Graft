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

test('CRLF file: no-op run reports unchanged and preserves bytes exactly', () => {
  const f = join(fresh(), 'AGENTS.md');
  const block = fencedBlock('same body', '\r\n');
  const original = `above\r\n\r\n${block}\r\nbelow\r\n`;
  writeFileSync(f, original);
  const r = upsertSection(f, 'same body');
  assert.equal(r.action, 'unchanged');
  const after = readFileSync(f, 'utf8');
  assert.equal(after, original, 'file must be byte-identical after a no-op run');
});

test('CRLF file: appending produces a block using CRLF line endings throughout', () => {
  const f = join(fresh(), 'AGENTS.md');
  writeFileSync(f, '# My rules\r\n\r\nBe nice.\r\n');
  const r = upsertSection(f, 'graft body');
  assert.equal(r.action, 'appended');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.startsWith('# My rules\r\n\r\nBe nice.\r\n'));
  assert.ok(text.includes('graft body'));
  // No bare '\n' without a preceding '\r' anywhere in the result.
  assert.equal(/(?<!\r)\n/.test(text), false, 'result must not mix LF into a CRLF file');
});

test('CRLF file: replacing the block with surrounding content keeps CRLF throughout', () => {
  const f = join(fresh(), 'AGENTS.md');
  const block = fencedBlock('old body', '\r\n');
  writeFileSync(f, `above\r\n\r\n${block}\r\nbelow\r\n`);
  const r = upsertSection(f, 'new body');
  assert.equal(r.action, 'replaced');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('above'));
  assert.ok(text.includes('below'));
  assert.ok(text.includes('new body'));
  assert.ok(!text.includes('old body'));
  assert.equal(/(?<!\r)\n/.test(text), false, 'result must not mix LF into a CRLF file');
});

test('CRLF file: replacing when the block IS the entire file keeps CRLF throughout', () => {
  const f = join(fresh(), 'AGENTS.md');
  const block = fencedBlock('old body', '\r\n');
  writeFileSync(f, `${block}\r\n`);
  const r = upsertSection(f, 'new body');
  assert.equal(r.action, 'replaced');
  const text = readFileSync(f, 'utf8');
  assert.ok(text.includes('new body'));
  assert.ok(!text.includes('old body'));
  assert.equal(/(?<!\r)\n/.test(text), false, 'result must not mix LF into a CRLF file');
});

test('fencedBlock does not double "\\r" when the body already has CRLF line endings', () => {
  const block = fencedBlock('line one\r\nline two', '\r\n');
  assert.equal(/\r\r/.test(block), false, 'must not contain doubled carriage returns');
  assert.equal(/(?<!\r)\n/.test(block), false, 'every \\n must be preceded by \\r');
});
