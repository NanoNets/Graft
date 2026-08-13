/**
 * Core tests for `graft grep` (src/search/grep.ts).
 *
 * `heavyRarelyRepo()` builds a small real fixture repo (same `builtRepo`
 * pattern as test/mcp-tools.test.ts) and runs the actual `graft build` CLI,
 * so inDegree/innermost-symbol attribution are exercised against a genuine
 * parsed graph, not a hand-rolled one. The narrower fixed/maxHits/zero-hit
 * assertions use a hand-built GraphV1 (just enough for grepGraph's file-node
 * iteration + regex/line logic) plus real files on disk, since they don't
 * need any symbol/edge structure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { grepGraph } from '../src/search/grep.js';
import { formatGrepResult, zeroHitNote } from '../src/search/grep-cli.js';
import { WALK_RELATIONS } from '../src/graph/relations.js';
import { readGraph, wiringPath } from '../src/graph/write.js';
import type { GraphV1, NodeV1 } from '../src/graph/types.js';

function fileNode(path: string, lines: number): NodeV1 {
  return {
    id: path,
    name: path,
    kind: 'file',
    path,
    span: `L1-L${lines}`,
    signature: null,
    exported: true,
    origin: 'ast',
    body_hash: '',
    summary_state: 'pending',
    summary: null,
    crux: null,
  };
}

function graphOf(nodes: NodeV1[], edges: GraphV1['edges'] = []): GraphV1 {
  return { meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: [] }, nodes, edges };
}

/** Two TS files: `NEEDLE` appears (a) inside a heavily-called function, (b)
 * inside a rarely-called one — both in a.ts — and (c) at module level plus
 * inside a class method in b.ts (the innermost-attribution case: the hit
 * must map to `Container.method`, not `Container`). Built via the real CLI
 * so inDegree comes from genuine `calls` edges. */
function needleRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(
    join(d, 'src', 'a.ts'),
    [
      'export function heavilyCalled(): void {',
      '  console.log("NEEDLE hit in heavilyCalled");',
      '}',
      '',
      'export function rarelyCalled(): void {',
      '  console.log("NEEDLE hit in rarelyCalled");',
      '}',
      '',
      'export function callerOne(): void { heavilyCalled(); }',
      'export function callerTwo(): void { heavilyCalled(); }',
      'export function callerThree(): void { heavilyCalled(); }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(d, 'src', 'b.ts'),
    [
      'console.log("NEEDLE at module level");',
      '',
      'export class Container {',
      '  method(): void {',
      '    console.log("NEEDLE inside Container.method");',
      '  }',
      '}',
      '',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d], { stdio: 'pipe' });
  return d;
}

function loadBuiltGraph(repo: string): GraphV1 {
  const g = readGraph(wiringPath(join(repo, 'graft')));
  assert.ok(g, 'expected a built graph.json');
  return g!;
}

test('WALK_RELATIONS (shared, src/graph/relations.ts): exactly the five dependency relations', () => {
  assert.deepEqual(
    [...WALK_RELATIONS].sort(),
    ['calls', 'extends', 'implements', 'imports', 'references'].sort(),
  );
  // Excluded on purpose: contains is structural (file->symbol), not dependency wiring.
  assert.equal(WALK_RELATIONS.has('contains' as never), false);
});

test('grepGraph: groups are ordered by inDegree desc, then path asc', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);
  const r = grepGraph(graph, repo, 'NEEDLE');

  assert.equal(r.pattern, 'NEEDLE');
  assert.equal(r.totalHits, 4);
  assert.equal(r.groups.length, 4);

  // heavilyCalled has 3 callers -> highest inDegree -> first.
  const first = r.groups[0];
  assert.equal(first.symbol?.kind, 'function');
  assert.match(first.symbol!.name, /heavilyCalled$/);
  assert.equal(first.inDegree, 3);

  // Every subsequent group has inDegree <= the previous (non-increasing).
  for (let i = 1; i < r.groups.length; i++) {
    assert.ok(r.groups[i].inDegree <= r.groups[i - 1].inDegree);
  }
  // Ties (inDegree 0) are ordered by path ascending.
  const zeroDegreeGroups = r.groups.filter((g) => g.inDegree === 0);
  const paths = zeroDegreeGroups.map((g) => g.path);
  assert.deepEqual(paths, [...paths].sort((a, b) => a.localeCompare(b)));
});

test('grepGraph: innermost-symbol attribution — a hit inside a class method maps to the method, not the class', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);
  const r = grepGraph(graph, repo, 'NEEDLE');

  const methodGroup = r.groups.find((g) => g.symbol?.kind === 'method');
  assert.ok(methodGroup, 'expected a group attributed to Container.method');
  assert.match(methodGroup!.symbol!.name, /Container\.method$/);
  assert.equal(methodGroup!.symbol!.path, 'src/b.ts');
  // No group should be attributed to the class itself.
  assert.equal(r.groups.some((g) => g.symbol?.kind === 'class'), false);
});

test('grepGraph: rarely-called function has inDegree 0 and is grouped separately from the heavily-called one', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);
  const r = grepGraph(graph, repo, 'NEEDLE');

  const rarelyGroup = r.groups.find((g) => g.symbol?.name.endsWith('rarelyCalled'));
  assert.ok(rarelyGroup);
  assert.equal(rarelyGroup!.inDegree, 0);
  assert.equal(rarelyGroup!.hits.length, 1);
  assert.match(rarelyGroup!.hits[0].text, /NEEDLE hit in rarelyCalled/);
});

test('grepGraph: a hit outside every symbol span groups as file-level (symbol: null, inDegree 0)', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);
  const r = grepGraph(graph, repo, 'NEEDLE');

  const moduleLevel = r.groups.find((g) => g.symbol === null);
  assert.ok(moduleLevel, 'expected a file-level (symbol: null) group');
  assert.equal(moduleLevel!.inDegree, 0);
  assert.equal(moduleLevel!.path, 'src/b.ts');
  assert.match(moduleLevel!.hits[0].text, /NEEDLE at module level/);
});

test('A3: a duplicate-named definition displays its minted ordinal in the grouped symbol name', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-dup-'));
  mkdirSync(join(d, 'src'), { recursive: true });
  writeFileSync(
    join(d, 'src', 'dup.ts'),
    [
      'export function helper(): void {',
      '  console.log("NEEDLE first");',
      '}',
      '',
      'export function helper(): void {',
      '  console.log("NEEDLE second");',
      '}',
      '',
    ].join('\n'),
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'build', d], { stdio: 'pipe' });
  const graph = loadBuiltGraph(d);
  const r = grepGraph(graph, d, 'NEEDLE');

  const names = r.groups.map((g) => g.symbol?.name).sort();
  assert.deepEqual(names, ['helper', 'helper~2'], 'the second definition displays its minted ordinal, not a bare duplicate name');
});

test('grepGraph: `in` filter narrows to matching file paths only', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);
  const r = grepGraph(graph, repo, 'NEEDLE', { in: 'src/a.ts' });

  assert.equal(r.filesSearched, 1);
  assert.equal(r.totalHits, 2);
  assert.ok(r.groups.every((g) => g.path === 'src/a.ts'));
});

test('grepGraph: `in` is a path prefix, not a substring, and errors when it matches nothing', () => {
  const repo = needleRepo();
  const graph = loadBuiltGraph(repo);

  // A bare filename is a mid-path fragment of 'src/a.ts', not a prefix of it.
  assert.throws(() => grepGraph(graph, repo, 'NEEDLE', { in: 'a.ts' }), /nothing indexed under "a\.ts\//);

  // A directory prefix works, and either separator is accepted.
  assert.equal(grepGraph(graph, repo, 'NEEDLE', { in: 'src' }).filesSearched, 2);
  assert.equal(grepGraph(graph, repo, 'NEEDLE', { in: 'src/' }).filesSearched, 2);
  // Native separator — `src\a.ts` on Windows, where this used to match nothing.
  assert.equal(grepGraph(graph, repo, 'NEEDLE', { in: join('src', 'a.ts') }).filesSearched, 1);
});

test('grepGraph: `fixed` escapes regex metacharacters — "a.b" does not match "axb"', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-fixed-'));
  writeFileSync(join(d, 'x.txt'), 'axb\na.b literal line\n');
  const graph = graphOf([fileNode('x.txt', 2)]);

  const asRegex = grepGraph(graph, d, 'a.b');
  assert.equal(asRegex.totalHits, 2); // '.' matches any char -> matches both lines

  const fixed = grepGraph(graph, d, 'a.b', { fixed: true });
  assert.equal(fixed.totalHits, 1);
  assert.match(fixed.groups[0].hits[0].text, /a\.b literal line/);
});

test('grepGraph: maxHits truncation surfaces in truncated.hits, not silently dropped', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-maxhits-'));
  const lines = Array.from({ length: 10 }, (_, i) => `NEEDLE line ${i}`).join('\n') + '\n';
  writeFileSync(join(d, 'many.txt'), lines);
  const graph = graphOf([fileNode('many.txt', 10)]);

  const r = grepGraph(graph, d, 'NEEDLE', { maxHits: 5 });
  assert.equal(r.totalHits, 5);
  assert.equal(r.truncated.hits, 5);
  assert.equal(
    r.groups.reduce((n, g) => n + g.hits.length, 0),
    5,
  );
});

test('grepGraph: zero-hit result has the documented shape — empty groups, zero counts, non-silent truncated', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-zero-'));
  writeFileSync(join(d, 'x.txt'), 'nothing interesting here\n');
  const graph = graphOf([fileNode('x.txt', 1)]);

  const r = grepGraph(graph, d, 'NOPE_NOT_PRESENT');
  assert.equal(r.pattern, 'NOPE_NOT_PRESENT');
  assert.equal(r.totalHits, 0);
  assert.deepEqual(r.groups, []);
  assert.equal(r.filesSearched, 1);
  assert.deepEqual(r.truncated, { files: 0, hits: 0 });
});

test('grepGraph: unreadable file is skipped and counted into truncated.files, not silently ignored', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-unreadable-'));
  writeFileSync(join(d, 'real.txt'), 'NEEDLE is here\n');
  // 'missing.txt' is indexed in the graph but does not exist on disk.
  const graph = graphOf([fileNode('real.txt', 1), fileNode('missing.txt', 1)]);

  const r = grepGraph(graph, d, 'NEEDLE');
  assert.equal(r.filesSearched, 2);
  assert.equal(r.truncated.files, 1);
  assert.equal(r.totalHits, 1);
});

test('grepGraph: CRLF files match end-anchored patterns — the \\r is not left on the line', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-crlf-'));
  // Exactly what a Windows checkout with git's default core.autocrlf=true holds.
  writeFileSync(join(d, 'crlf.ts'), 'const foo = 1;\r\nconst bar = 2;\r\n');
  writeFileSync(join(d, 'lf.ts'), 'const foo = 1;\nconst bar = 2;\n');
  const graph = graphOf([fileNode('crlf.ts', 2), fileNode('lf.ts', 2)]);

  // `;$` is the ordinary "line ends with a semicolon" pattern. Splitting on
  // "\n" alone leaves "const foo = 1;\r", where `$` never matches — so the CRLF
  // file silently contributed zero hits while the LF file contributed two.
  const anchored = grepGraph(graph, d, ';$');
  assert.equal(anchored.totalHits, 4, 'both CRLF lines and both LF lines must match an end-anchored pattern');
  assert.deepEqual(
    [...new Set(anchored.groups.map((g) => g.path))].sort(),
    ['crlf.ts', 'lf.ts'],
  );

  // The stray \r must not survive into the reported hit text either.
  const text = grepGraph(graph, d, 'foo').groups.flatMap((g) => g.hits).map((h) => h.text);
  assert.equal(text.some((t) => t.includes('\r')), false, 'hit text must be free of the CRLF carriage return');
});

test('grepGraph: a catastrophically-backtracking pattern is bounded by the time budget, and says so', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-redos-'));
  // `(a+)+b` against a line of a's with no b is the textbook exponential case:
  // ~22 a's is a few ms of pure backtracking, and 300 such lines is minutes of
  // a wedged event loop — on the MCP server that is every other tool call too.
  const line = 'a'.repeat(22) + '!';
  writeFileSync(join(d, 'evil.txt'), Array.from({ length: 300 }, () => line).join('\n') + '\n');
  const graph = graphOf([fileNode('evil.txt', 300)]);

  const t0 = Date.now();
  const r = grepGraph(graph, d, '(a+)+b', { budgetMs: 300 });
  const elapsed = Date.now() - t0;

  assert.equal(r.truncated.timeout, true, 'giving up must be reported, never silent');
  assert.equal(r.filesSearched, 1, 'only the files actually opened are reported as searched');
  // Generous ceiling: the budget bounds the loop, one in-flight RegExp.test can
  // still overshoot it. Unbounded, this run takes tens of seconds.
  assert.ok(elapsed < 5_000, `expected the scan to be bounded, took ${elapsed}ms`);
});

/** `files` file nodes plus `symbols` symbol nodes spread evenly over them —
 * the shape (not the content) of a large real graph, for the grouping-cost
 * assertions below. */
function wideGraph(files: number, symbols: number): GraphV1 {
  const nodes: NodeV1[] = [];
  for (let f = 0; f < files; f++) nodes.push(fileNode(`src/f${f}.ts`, 100));
  for (let s = 0; s < symbols; s++) {
    const f = s % files;
    nodes.push({
      ...fileNode(`src/f${f}.ts`, 100),
      id: `src/f${f}.ts#sym${s}`,
      name: `sym${s}`,
      kind: 'function',
      span: `L${(s % 90) + 1}-L${(s % 90) + 2}`,
    });
  }
  return graphOf(nodes);
}

test('grepGraph: symbol grouping is indexed once per call, not re-scanned per file', () => {
  // 1000 files x 100000 symbols — a few times this repo's own cited scale
  // ("at 32k nodes"), deliberately symbol-heavy so the quadratic term is what
  // the clock sees. The old per-file `symbolsOf` walked ALL 101000 nodes for
  // every file (101M node visits) purely to bucket spans; the one-pass index
  // makes it 101000 visits total. Kept few enough files that the ENOENT cost
  // of the (deliberately absent) sources stays small next to the grouping.
  const graph = wideGraph(1_000, 100_000);
  const dir = mkdtempSync(join(tmpdir(), 'graft-grep-perf-'));

  const t0 = Date.now();
  const r = grepGraph(graph, dir, 'NEEDLE');
  const elapsed = Date.now() - t0;

  assert.equal(r.filesSearched, 1_000);
  assert.ok(elapsed < 400, `grouping should be near-linear in nodes, took ${elapsed}ms`);
});

test('grepGraph: the per-file symbol buckets are complete and start-sorted (what the one-pass index must preserve)', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-buckets-'));
  writeFileSync(join(d, 'a.ts'), 'NEEDLE\n'.repeat(6));
  writeFileSync(join(d, 'b.ts'), 'NEEDLE\n'.repeat(6));
  const sym = (path: string, name: string, span: string): NodeV1 => ({
    ...fileNode(path, 6),
    id: `${path}#${name}`,
    name,
    kind: 'function',
    span,
  });
  // Deliberately out of span order in `graph.nodes`, and interleaved between
  // files: `enclosingSymbol` stops at the first span that starts after the
  // line, so a bucket that isn't sorted by start silently loses hits.
  const graph = graphOf([
    fileNode('a.ts', 6),
    fileNode('b.ts', 6),
    sym('a.ts', 'late', 'L5-L6'),
    sym('b.ts', 'only', 'L1-L6'),
    sym('a.ts', 'early', 'L1-L2'),
  ]);

  const r = grepGraph(graph, d, 'NEEDLE');
  const named = new Map(r.groups.filter((g) => g.symbol).map((g) => [g.symbol!.name, g.hits.map((h) => h.line)]));
  assert.deepEqual(named.get('early'), [1, 2]);
  assert.deepEqual(named.get('late'), [5, 6]);
  assert.deepEqual(named.get('only'), [1, 2, 3, 4, 5, 6]);
  // a.ts lines 3-4 fall outside every span -> file-level group, and b.ts has none.
  const fileLevel = r.groups.filter((g) => g.symbol === null);
  assert.equal(fileLevel.length, 1);
  assert.deepEqual(fileLevel[0], { symbol: null, path: 'a.ts', inDegree: 0, hits: [{ line: 3, text: 'NEEDLE' }, { line: 4, text: 'NEEDLE' }] });
});

test('grep-cli.ts: a timeout is surfaced by BOTH the CLI notes, and never as a complete search', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-cli-timeout-'));
  const line = 'a'.repeat(22) + '!';
  writeFileSync(join(d, 'evil.txt'), Array.from({ length: 300 }, () => line).join('\n') + '\n');
  const graph = graphOf([fileNode('evil.txt', 300)]);

  // The MCP side already said this (`grepTimeoutNote` in mcp/tools.ts); the CLI's
  // own two notes never mentioned the flag, so `graft grep` printed a zero-hit
  // result claiming "All indexed code was searched" over a scan that gave up.
  const none = grepGraph(graph, d, '(a+)+b', { budgetMs: 300 });
  assert.equal(none.truncated.timeout, true);
  const zero = zeroHitNote(none);
  assert.match(zero, /never searched/);
  assert.doesNotMatch(zero, /All indexed code was searched/);

  // …and with hits, the header note has to carry it too — the note rides under the
  // header precisely so a `head -N` of the report cannot lose the one line saying
  // the answer is partial. Hand-built, because a pattern that both matches AND
  // backtracks catastrophically is not something to make deterministic.
  const withHits = {
    ...none,
    totalHits: 1,
    groups: [{ symbol: null, path: 'evil.txt', inDegree: 0, hits: [{ line: 1, text: line }] }],
  };
  const report = formatGrepResult(withHits);
  assert.match(report.split('\n')[1], /truncated: search hit its time budget/);
});

test('zeroHitNote (grep-cli.ts): zero hits AND unreadable indexed files mentions the unreadable count, not just the zero-hit note', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-grep-zero-unreadable-'));
  writeFileSync(join(d, 'real.txt'), 'nothing interesting here\n');
  // 'missing.txt' is indexed in the graph but does not exist on disk — the
  // graph is stale (or the root is wrong) relative to what's on disk.
  const graph = graphOf([fileNode('real.txt', 1), fileNode('missing.txt', 1)]);

  const r = grepGraph(graph, d, 'NOPE_NOT_PRESENT');
  assert.equal(r.totalHits, 0);
  assert.equal(r.truncated.files, 1);

  const note = zeroHitNote(r);
  // The plain zero-hit wording must still be there...
  assert.match(note, /no hits for "NOPE_NOT_PRESENT"/);
  // ...but truncation is never silent: 1 unreadable file must be surfaced too.
  assert.match(note, /1 indexed file.*could not be read/);
});
