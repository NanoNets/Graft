/**
 * CLI tests for `graft callers` and its `--direction`/`--depth` flags — the one
 * command that wires src/graph/traverse.ts's pure resolver + edge-walkers into
 * the `graft` binary (`--direction out` is the old `callees`; `--depth N` is the
 * old `impact`). Runs the real CLI via execFileSync (same pattern as
 * test/mcp-tools.test.ts's `builtRepo` helper) against a built fixture repo,
 * so these tests exercise the actual process boundary: exit codes, stdout vs
 * stderr, and --json shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function builtRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'graft-traversecli-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(
    join(d, 'src', 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n' +
      'export function sub(a: number, b: number): number {\n  return add(a, -b);\n}\n' +
      'export function compute(a: number, b: number): number {\n  return sub(a, b);\n}\n',
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d], { stdio: 'pipe' });
  return d;
}

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', status: e.status ?? 1 };
  }
}

test('graft callers: happy path shows header and the caller hit', () => {
  const d = builtRepo();
  const r = runCli(['callers', 'add', d]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /add · function · src\/math\.ts:/);
  assert.match(r.stdout, /calls ← sub \(src\/math\.ts:/);
});

test('graft callers --json: shape matches {query, matches:[{symbol,hits}]}', () => {
  const d = builtRepo();
  const r = runCli(['callers', 'add', d, '--json']);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.query, 'add');
  assert.equal(parsed.matches.length, 1);
  const m = parsed.matches[0];
  assert.equal(m.symbol.name, 'add');
  assert.equal(m.symbol.kind, 'function');
  assert.ok(m.symbol.path.endsWith('math.ts'));
  assert.ok(m.symbol.id);
  assert.ok(m.symbol.span);
  assert.equal(m.hits.length, 1);
  assert.equal(m.hits[0].name, 'sub');
  assert.equal(m.hits[0].relation, 'calls');
  assert.equal(m.hits[0].depth, 1);
});

test('graft callers: unknown symbol exits 1 with a stderr message', () => {
  const d = builtRepo();
  const r = runCli(['callers', 'noSuchSymbolAnywhere', d]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no symbol "noSuchSymbolAnywhere" in the graph/);
  assert.match(r.stderr, /graft build/);
  assert.equal(r.stdout, '');
});

test('graft callers --direction out: happy path shows the outgoing (callee) hit', () => {
  const d = builtRepo();
  // `sub` calls `add`, so its outgoing edge points at add with a `→` arrow.
  const r = runCli(['callers', 'sub', d, '--direction', 'out']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /sub · function · src\/math\.ts:/);
  assert.match(r.stdout, /calls → add \(src\/math\.ts:/);
});

test('graft callers --direction out: zero-edge symbol prints a loud callees note and still exits 0', () => {
  const d = builtRepo();
  // `add` calls nothing, so its callees are empty — must not be a silent list.
  const r = runCli(['callers', 'add', d, '--direction', 'out']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /add · function · src\/math\.ts:/);
  assert.match(r.stdout, /no indexed callees/);
  assert.match(r.stdout, /grep -rn "add"/);
});

test('graft callers --direction out --json: zero-edge symbol includes a note field', () => {
  const d = builtRepo();
  const r = runCli(['callers', 'add', d, '--direction', 'out', '--json']);
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.query, 'add');
  assert.equal(parsed.matches.length, 1);
  const m = parsed.matches[0];
  assert.equal(m.symbol.name, 'add');
  assert.equal(m.hits.length, 0);
  assert.ok(m.note, 'zero-edge match must have a note field');
  assert.match(m.note, /try grep -rn/);
});

test('graft callers --depth: depth flag walks the BFS transitively (blast radius)', () => {
  const d = builtRepo();
  // compute -> sub -> add: callers of `add` at depth 1 is just `sub`;
  // depth 2 also reaches `compute` and tags each hit with its depth.
  const shallow = runCli(['callers', 'add', d, '--depth', '1']);
  assert.equal(shallow.status, 0);
  assert.match(shallow.stdout, /← sub \(/);
  assert.doesNotMatch(shallow.stdout, /compute/);
  assert.doesNotMatch(shallow.stdout, /\[depth/); // depth 1 → no depth tags

  const deeper = runCli(['callers', 'add', d, '--depth', '2']);
  assert.equal(deeper.status, 0);
  assert.match(deeper.stdout, /← sub \(/);
  assert.match(deeper.stdout, /\[depth 1\]/);
  assert.match(deeper.stdout, /← compute \(/);
  assert.match(deeper.stdout, /\[depth 2\]/);
});

test('graft callers --direction: rejects a bad value with exit 1', () => {
  const d = builtRepo();
  const r = runCli(['callers', 'add', d, '--direction', 'sideways']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--direction must be "in" or "out"/);
});

test('graft callers: no graph at all is a stderr error, exit 1', () => {
  const bare = mkdtempSync(join(tmpdir(), 'graft-traversecli-bare-'));
  const r = runCli(['callers', 'add', bare]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /graft build/);
});
