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

/** Three-deep call chain (compute -> sub -> add) so a `--depth`/`depth` param
 * has something to distinguish: depth 1 from `add` reaches only `sub`, the
 * default depth (2) also reaches `compute`. Same fixture shape as
 * test/graph-traverse-cli.test.ts's `impact -d` test. */
function chainRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'graft-mcptools-chain-'));
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

/** Graph lives in a NON-default dir (`<repo>/customgraph`, not `<repo>/graft`)
 * — exercises the `--dir` override threaded through to `contextDirFor`. */
function customDirRepo(): { repo: string; graphDir: string } {
  const d = mkdtempSync(join(tmpdir(), 'graft-mcptools-customdir-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'math.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\nexport function sub(a: number, b: number): number {\n  return add(a, -b);\n}\n');
  const graphDir = join(d, 'customgraph');
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d, '--dir', graphDir], { stdio: 'pipe' });
  return { repo: d, graphDir };
}

/** b.ts imports a.ts AND calls a function (`helper`) defined in a.ts. The
 * `imports` edge targets a.ts's FILE id; the `calls` edge targets `helper`'s
 * SYMBOL id — two different node ids, both "in" a.ts from a human's view. */
function fileScopeRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'graft-mcptools-filescope-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(join(d, 'src', 'a.ts'), 'export function helper(): number {\n  return 42;\n}\n');
  writeFileSync(
    join(d, 'src', 'b.ts'),
    "import { helper } from './a';\n\nexport function useB(): number {\n  return helper();\n}\n",
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d], { stdio: 'pipe' });
  return d;
}

test('TOOLS lists all five tools with schemas', () => {
  assert.deepEqual(TOOLS.map((t) => t.name), [
    'graft_ask',
    'graft_check',
    'graft_blast_radius',
    'graft_callers',
    'graft_callees',
  ]);
  for (const t of TOOLS) {
    assert.ok(t.description.length > 0);
    assert.equal((t.inputSchema as { type: string }).type, 'object');
  }
  // graft_blast_radius accepts `symbol` as an alternative to `file` (callTool
  // does `args.symbol ?? args.file`) — the schema must document it too.
  const blastRadius = TOOLS.find((t) => t.name === 'graft_blast_radius')!;
  const props = (blastRadius.inputSchema as { properties: Record<string, unknown> }).properties;
  assert.ok('symbol' in props, 'graft_blast_radius schema should document `symbol`');
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

test('graft_callers round-trips a caller on the built fixture', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_callers', { symbol: 'add' });
  assert.equal(r.isError, false);
  assert.match(r.text, /add · function · src\/math\.ts:/);
  assert.match(r.text, /calls ← sub \(src\/math\.ts:/);
});

test('graft_callers: qualified/--in narrowing still resolves through the shared resolver', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_callers', { symbol: 'add', in: 'math' });
  assert.equal(r.isError, false);
  assert.match(r.text, /calls ← sub/);
  const miss = callTool(d, 'graft_callers', { symbol: 'add', in: 'nowhere' });
  assert.equal(miss.isError, true);
  assert.match(miss.text, /no symbol "add" in the graph/);
});

test('graft_callees round-trips a callee, and reports a loud note when there are none', () => {
  const d = builtRepo();
  const callee = callTool(d, 'graft_callees', { symbol: 'sub' });
  assert.equal(callee.isError, false);
  assert.match(callee.text, /calls → add \(src\/math\.ts:/);

  // `add` calls nothing, so its callees are empty — must be a loud note, not silence.
  const empty = callTool(d, 'graft_callees', { symbol: 'add' });
  assert.equal(empty.isError, false);
  assert.match(empty.text, /no indexed callees/);
  assert.match(empty.text, /grep -rn "add"/);
});

test('graft_callers/graft_callees: unknown symbol is a soft isError', () => {
  const d = builtRepo();
  const r1 = callTool(d, 'graft_callers', { symbol: 'noSuchSymbolAnywhere' });
  assert.equal(r1.isError, true);
  assert.match(r1.text, /no symbol "noSuchSymbolAnywhere" in the graph/);
  assert.match(r1.text, /check spelling|graft build/);

  const r2 = callTool(d, 'graft_callees', {});
  assert.equal(r2.isError, true);
  assert.match(r2.text, /requires a symbol/);
});

test('graft_blast_radius: depth param is honored (default 2 reaches further than depth 1)', () => {
  const d = chainRepo();
  const shallow = callTool(d, 'graft_blast_radius', { file: 'add', depth: 1 });
  assert.equal(shallow.isError, false);
  assert.match(shallow.text, /← sub \(/);
  assert.doesNotMatch(shallow.text, /compute/);

  const deeper = callTool(d, 'graft_blast_radius', { file: 'add' });
  assert.equal(deeper.isError, false);
  assert.match(deeper.text, /← sub \(/);
  assert.match(deeper.text, /\[depth 1\]/);
  assert.match(deeper.text, /← compute \(/);
  assert.match(deeper.text, /\[depth 2\]/);
});

test('graft_blast_radius: file-scope match aggregates dependents that call into a symbol the file defines, not just file-level imports', () => {
  const d = fileScopeRepo();
  const r = callTool(d, 'graft_blast_radius', { file: 'src/a.ts' });
  assert.equal(r.isError, false);
  // Old behavior (walking only the FILE node's incoming edges) found b.ts via
  // `imports` but silently dropped it via `calls`, since a `calls` edge
  // targets the SYMBOL id (`src/a.ts#helper`), never the FILE id.
  assert.match(r.text, /imports ← b\.ts \(src\/b\.ts/);
  assert.match(r.text, /calls ← useB \(src\/b\.ts/);
});

test('graft_blast_radius: unknown symbol is a soft isError with the check-spelling message', () => {
  const d = builtRepo();
  const r = callTool(d, 'graft_blast_radius', { file: 'noSuchSymbolAnywhere' });
  assert.equal(r.isError, true);
  assert.match(r.text, /no symbol "noSuchSymbolAnywhere" in the graph/);
  assert.match(r.text, /check spelling/);
});

test('callTool honors a dirOverride for a graph built in a non-default dir', () => {
  const { repo, graphDir } = customDirRepo();

  // With the override pointing at the actual graph location, tools find it.
  const check = callTool(repo, 'graft_check', {}, graphDir);
  assert.equal(check.isError, false);
  assert.match(check.text, /graph check: OK/);

  const callers = callTool(repo, 'graft_callers', { symbol: 'add' }, graphDir);
  assert.equal(callers.isError, false);
  assert.match(callers.text, /calls ← sub \(src\/math\.ts:/);

  // Without the override, tools fall back to the default `<repo>/graft`,
  // which doesn't exist here — must report no graph, not silently succeed.
  const noOverride = callTool(repo, 'graft_callers', { symbol: 'add' });
  assert.equal(noOverride.isError, true);
  assert.match(noOverride.text, /graft build/);
});
