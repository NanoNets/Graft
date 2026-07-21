import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TOOLS, callTool } from '../src/mcp/tools.js';

function builtRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'graft-mcptools-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sub(a: number, b: number): number {\n  return add(a, -b);\n}\n');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d], { stdio: 'pipe' });
  return d;
}

test('TOOLS lists the three tools with schemas', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ['graft_ask', 'graft_check', 'graft_blast_radius']);
  for (const t of TOOLS) {
    assert.ok(t.description.length > 0);
    assert.equal((t.inputSchema as { type: string }).type, 'object');
  }
});

test('graft_ask returns ranked hits for a built repo', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_ask', { query: 'how do I add numbers' });
  assert.equal(r.isError, false);
  assert.match(r.text, /add/);
  assert.match(r.text, /src\/math\.ts/);
});

test('graft_check reports the wiring state', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_check', {});
  assert.equal(r.isError, false);
  assert.match(r.text, /graph check: OK/);
});

test('graft_blast_radius names dependents of a file', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_blast_radius', { file: 'src/math.ts' });
  assert.equal(r.isError, false);
  assert.ok(r.text.length > 0);
});

test('unbuilt repo and unknown tool are soft errors', () => {
  const bare = mkdtempSync(join(tmpdir(), 'graft-mcptools-bare-'));
  const r1 = callTool(bare, 'graft_blast_radius', { file: 'x.ts' });
  assert.equal(r1.isError, true);
  assert.match(r1.text, /graft build/);
  const r2 = callTool(bare, 'nope', {});
  assert.equal(r2.isError, true);
  assert.match(r2.text, /unknown tool/i);
});
