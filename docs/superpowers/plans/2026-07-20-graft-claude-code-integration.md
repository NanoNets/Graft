# Graft × Claude Code Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `.claude/` integration that makes Graft visible (a live statusline) and active (retrieval, orientation, blast-radius) inside a Claude Code session, and keeps the graph fresh via turn-end auto-sync.

**Architecture:** Reader/writer/state split. Testable logic lives in `src/claude/*.ts` (compiled to `dist/claude/`); thin `.claude/helpers/*.cjs` shims invoke it. A pure `statusline` reader renders from small precomputed state files (`graft/.cache/stats.json`) plus Claude Code's stdin; `hooks` fire on real events (edit, prompt, session-start, stop) to write state and inject context; a detached `sync-run` rebuilds the graph in the background under a lock.

**Tech Stack:** Node 20+ (ESM), TypeScript (strict), `node:test` + `node:assert/strict`, `tsx`. No new dependencies. Graft CLI (`node dist/cli.js`) invoked as a child process for `ask` / `check` / `build`.

## Global Constraints

- **Money guard (hard rule):** auto-sync and every hook run **only** plain `graft build` / `graft ask` / `graft check`. **Never** `graft build --deep` (spends OpenRouter credits). Copied verbatim from spec §7.
- **Honest data only:** never display `$` cost or a "tokens saved %". Only real (on-disk / stdin) or instrumented-then-real signals. (spec §2, §5)
- **`enrichedPct` visibility:** show the enriched segment **only when `readyCount ≥ 1`**; hide entirely for a structural-only graph. (spec §5, §13.1)
- **`graftReads`/`sourceReads`:** present as **reserved fields** in `SessionState` (schema ready, default 0), **not displayed** and **not yet populated** — population lands with the deferred PreToolUse read-counter (spec §3). Do not add a counter hook in this plan. (spec §13.2)
- **Statusline is a pure reader:** it must read only small files + stdin and spawn **no** subprocess. (spec §5)
- **All hooks are best-effort:** any failure logs/degrades and exits 0; never throw out of a hook. (spec §10)
- **Node ESM:** `src/` is `"type": "module"`; import paths use `.js` extensions. `.cjs` shims load ESM via dynamic `import()`.
- **State location:** all mutable state under `graft/.cache/` (gitignored). (spec §2, §4)
- **Ignore edits under `graft/`** — they never set dirty and never trigger sync (avoid loops). (spec §7)

---

## File Structure

**Created (committed):**
- `src/claude/state.ts` — types (`Stats`, `SessionState`), paths, atomic read/write, lock.
- `src/claude/stats.ts` — `readWiring`, `computeStats`.
- `src/claude/format.ts` — pure renderers/formatters (statusline, blast-radius, retrieval, orientation).
- `src/claude/statusline.ts` — statusline entry (`main`).
- `src/claude/hooks.ts` — hook dispatcher (`main(event)`).
- `src/claude/sync-run.ts` — detached background sync runner.
- `.claude/helpers/graft-statusline.cjs` — statusline shim.
- `.claude/helpers/graft-hooks.cjs` — hooks shim.
- `.claude/settings.json` — wires statusLine, subagentStatusLine, hooks, footerLinksRegexes.
- `test/claude-state.test.ts`, `test/claude-stats.test.ts`, `test/claude-format.test.ts`, `test/claude-hooks.test.ts` — tests.

**Modified:** none in `src/` proper; `tsconfig.json` only if it doesn't already include `src/claude` (it includes `src`, so no change expected — a build step verifies `dist/claude/` appears).

**State (gitignored, runtime):** `graft/.cache/stats.json`, `graft/.cache/session/<id>.json`, `graft/.cache/.sync.lock`.

---

## Task 1: State module (types, storage, lock)

**Files:**
- Create: `src/claude/state.ts`
- Test: `test/claude-state.test.ts`

**Interfaces:**
- Produces:
  - `interface Stats { nodeCount:number; edgeCount:number; languages:string[]; totalCount:number; readyCount:number; staleCount:number; dirty:boolean; syncing:boolean; syncedAt:string|null; lastFile:string|null }`
  - `interface SessionState { lastQuery:string|null; perAgentQuery:Record<string,string>; graftReads:number; sourceReads:number }`
  - `emptyStats(): Stats`
  - `cacheDir(projectDir:string): string`
  - `readStats(dir:string): Stats|null`
  - `writeStats(dir:string, s:Stats): void`
  - `patchStats(dir:string, patch:Partial<Stats>): Stats`
  - `readSession(dir:string, id:string): SessionState`
  - `writeSession(dir:string, id:string, s:SessionState): void`
  - `acquireLock(dir:string): boolean`
  - `releaseLock(dir:string): void`
  - `const LOCK_STALE_MS = 300000`

- [ ] **Step 1: Write the failing test**

```ts
// test/claude-state.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyStats, readStats, writeStats, patchStats,
  readSession, writeSession, acquireLock, releaseLock, cacheDir,
} from '../src/claude/state.js';

function fresh(): string { return mkdtempSync(join(tmpdir(), 'graft-state-')); }

test('stats round-trip and patch merge', () => {
  const d = fresh();
  assert.equal(readStats(d), null);
  writeStats(d, { ...emptyStats(), nodeCount: 319, edgeCount: 730 });
  assert.equal(readStats(d)!.nodeCount, 319);
  const patched = patchStats(d, { dirty: true, staleCount: 4 });
  assert.equal(patched.dirty, true);
  assert.equal(patched.staleCount, 4);
  assert.equal(readStats(d)!.edgeCount, 730, 'patch preserves other fields');
});

test('session defaults and round-trip', () => {
  const d = fresh();
  const s = readSession(d, 'abc');
  assert.deepEqual(s, { lastQuery: null, perAgentQuery: {}, graftReads: 0, sourceReads: 0 });
  s.lastQuery = 'pkce'; s.graftReads = 2;
  writeSession(d, 'abc', s);
  assert.equal(readSession(d, 'abc').lastQuery, 'pkce');
  assert.equal(readSession(d, 'xyz').graftReads, 0, 'other sessions isolated');
});

test('lock is exclusive then releasable', () => {
  const d = fresh();
  assert.equal(acquireLock(d), true);
  assert.equal(acquireLock(d), false, 'second acquire blocked while held');
  assert.ok(existsSync(join(cacheDir(d), '.sync.lock')));
  releaseLock(d);
  assert.equal(acquireLock(d), true, 'reacquire after release');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/claude-state.test.ts` (or `node --import tsx --test test/claude-state.test.ts`)
Expected: FAIL — `Cannot find module '../src/claude/state.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/claude/state.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Stats {
  nodeCount: number; edgeCount: number; languages: string[];
  totalCount: number; readyCount: number;
  staleCount: number; dirty: boolean; syncing: boolean;
  syncedAt: string | null; lastFile: string | null;
}
export interface SessionState {
  lastQuery: string | null;
  perAgentQuery: Record<string, string>;
  graftReads: number; sourceReads: number;
}

export const LOCK_STALE_MS = 300000;

export function emptyStats(): Stats {
  return { nodeCount: 0, edgeCount: 0, languages: [], totalCount: 0, readyCount: 0,
    staleCount: 0, dirty: false, syncing: false, syncedAt: null, lastFile: null };
}
function emptySession(): SessionState {
  return { lastQuery: null, perAgentQuery: {}, graftReads: 0, sourceReads: 0 };
}

export function cacheDir(projectDir: string): string { return join(projectDir, 'graft', '.cache'); }
function statsPath(d: string): string { return join(cacheDir(d), 'stats.json'); }
function sessionPath(d: string, id: string): string { return join(cacheDir(d), 'session', `${id}.json`); }
function lockPath(d: string): string { return join(cacheDir(d), '.sync.lock'); }

function readJson<T>(p: string): T | null {
  try { return JSON.parse(readFileSync(p, 'utf8')) as T; } catch { return null; }
}
function writeJsonAtomic(p: string, value: unknown): void {
  mkdirSync(join(p, '..'), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2));
  renameSync(tmp, p);
}

export function readStats(d: string): Stats | null { return readJson<Stats>(statsPath(d)); }
export function writeStats(d: string, s: Stats): void { writeJsonAtomic(statsPath(d), s); }
export function patchStats(d: string, patch: Partial<Stats>): Stats {
  const next: Stats = { ...(readStats(d) ?? emptyStats()), ...patch };
  writeStats(d, next);
  return next;
}
export function readSession(d: string, id: string): SessionState {
  return readJson<SessionState>(sessionPath(d, id)) ?? emptySession();
}
export function writeSession(d: string, id: string, s: SessionState): void {
  writeJsonAtomic(sessionPath(d, id), s);
}

export function acquireLock(d: string): boolean {
  const p = lockPath(d);
  if (existsSync(p) && Date.now() - statSync(p).mtimeMs < LOCK_STALE_MS) return false;
  mkdirSync(cacheDir(d), { recursive: true });
  writeFileSync(p, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  return true;
}
export function releaseLock(d: string): void { try { rmSync(lockPath(d)); } catch { /* already gone */ } }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/claude-state.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/claude/state.ts test/claude-state.test.ts
git commit -m "feat(claude): state module — stats/session storage + sync lock"
```

---

## Task 2: Stats computation from wiring.json

**Files:**
- Create: `src/claude/stats.ts`
- Test: `test/claude-stats.test.ts`

**Interfaces:**
- Consumes: `Stats` from `state.ts`; `GraphV1` from `src/graph/types.ts`.
- Produces:
  - `readWiring(projectDir:string): GraphV1|null`
  - `computeStats(w:GraphV1): Pick<Stats,'nodeCount'|'edgeCount'|'languages'|'totalCount'|'readyCount'>`

- [ ] **Step 1: Write the failing test**

```ts
// test/claude-stats.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../src/claude/stats.js';

const wiring = {
  meta: { version: 1, nodeCount: 3, edgeCount: 2, languages: ['typescript'] },
  nodes: [
    { id: 'a', summary_state: 'ready' },
    { id: 'b', summary_state: 'pending' },
    { id: 'c', summary_state: 'ready' },
  ],
  edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'a' }],
} as any;

test('computeStats derives counts and readyCount', () => {
  const s = computeStats(wiring);
  assert.equal(s.nodeCount, 3);
  assert.equal(s.edgeCount, 2);
  assert.deepEqual(s.languages, ['typescript']);
  assert.equal(s.totalCount, 3);
  assert.equal(s.readyCount, 2);
});

test('computeStats tolerates missing meta by counting arrays', () => {
  const s = computeStats({ nodes: [{ id: 'x', summary_state: 'pending' }], edges: [] } as any);
  assert.equal(s.nodeCount, 1);
  assert.equal(s.edgeCount, 0);
  assert.equal(s.readyCount, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/claude-stats.test.ts`
Expected: FAIL — cannot find `../src/claude/stats.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/claude/stats.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphV1 } from '../graph/types.js';
import type { Stats } from './state.js';

export function readWiring(projectDir: string): GraphV1 | null {
  try {
    return JSON.parse(readFileSync(join(projectDir, 'graft', '.graph', 'wiring.json'), 'utf8')) as GraphV1;
  } catch { return null; }
}

export function computeStats(
  w: GraphV1,
): Pick<Stats, 'nodeCount' | 'edgeCount' | 'languages' | 'totalCount' | 'readyCount'> {
  const nodes = w.nodes ?? [];
  const edges = w.edges ?? [];
  const readyCount = nodes.filter((n) => n.summary_state === 'ready').length;
  return {
    nodeCount: w.meta?.nodeCount ?? nodes.length,
    edgeCount: w.meta?.edgeCount ?? edges.length,
    languages: w.meta?.languages ?? [],
    totalCount: nodes.length,
    readyCount,
  };
}
```

> If `tsc` reports that `GraphV1` lacks `nodes`/`edges`/`meta` or `NodeV1` lacks `summary_state`, open `src/graph/types.ts` and use the exact exported names (spec §2 lists them: `meta.{nodeCount,edgeCount,languages}`, node `summary_state`). Adjust the property access to match; do not redefine the types.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/claude-stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/claude/stats.ts test/claude-stats.test.ts
git commit -m "feat(claude): computeStats + readWiring"
```

---

## Task 3: Statusline renderer + shim + settings (the visible bar)

**Files:**
- Create: `src/claude/format.ts`, `src/claude/statusline.ts`, `.claude/helpers/graft-statusline.cjs`, `.claude/settings.json`
- Test: `test/claude-format.test.ts`

**Interfaces:**
- Consumes: `Stats`, `SessionState` from `state.ts`; `readStats`, `readSession`.
- Produces (in `format.ts`):
  - `renderStatusline(stats:Stats|null, session:SessionState|null, ctx:{ctxPct:number|null}): string[]`
  - `enrichedSegment(s:Stats): string|null`
  - `freshnessSegment(s:Stats): string`
- Produces (in `statusline.ts`): `main(): void`

- [ ] **Step 1: Write the failing test** (assert on plain text — strip ANSI)

```ts
// test/claude-format.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatusline, enrichedSegment } from '../src/claude/format.js';
import { emptyStats } from '../src/claude/state.js';

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

test('not-built state', () => {
  const lines = renderStatusline(null, null, { ctxPct: null });
  assert.match(strip(lines[0]), /not built/);
});

test('enriched segment hidden when zero ready', () => {
  assert.equal(enrichedSegment({ ...emptyStats(), totalCount: 10, readyCount: 0 }), null);
});

test('enriched segment shown when >=1 ready', () => {
  const seg = enrichedSegment({ ...emptyStats(), totalCount: 4, readyCount: 2 });
  assert.equal(strip(seg!), '50% enriched');
});

test('two-line bar: size + freshness + ctx + last', () => {
  const stats = { ...emptyStats(), nodeCount: 319, edgeCount: 730, totalCount: 319, readyCount: 0,
    dirty: true, staleCount: 4, lastFile: 'pkce.ts' };
  const lines = renderStatusline(stats, null, { ctxPct: 34 }).map(strip);
  assert.match(lines[0], /graft/);
  assert.match(lines[0], /319 nodes \/ 730 edges/);
  assert.doesNotMatch(lines[0], /enriched/); // hidden at readyCount 0
  assert.match(lines[0], /⚠ 4 stale/);
  assert.match(lines[1], /ctx 34%/);
  assert.match(lines[1], /last: pkce\.ts/);
});

test('syncing overrides stale; synced when clean', () => {
  const base = { ...emptyStats(), nodeCount: 1, edgeCount: 0, totalCount: 1 };
  assert.match(strip(renderStatusline({ ...base, syncing: true, dirty: true }, null, { ctxPct: null })[0]), /syncing/);
  assert.match(strip(renderStatusline(base, null, { ctxPct: null })[0]), /✓ synced/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: FAIL — cannot find `../src/claude/format.js`.

- [ ] **Step 3: Write `format.ts` (statusline parts only for now)**

```ts
// src/claude/format.ts
import { basename } from 'node:path';
import type { Stats, SessionState } from './state.js';

const C = {
  indigo: (s: string) => `\x1b[38;2;84;111;255m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;2;224;165;68m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[38;5;244m${s}\x1b[0m`,
  text: (s: string) => `\x1b[38;5;251m${s}\x1b[0m`,
};
const SEP = C.muted(' · ');

export function enrichedSegment(s: Stats): string | null {
  if (s.readyCount < 1) return null;
  const pct = s.totalCount ? Math.round((s.readyCount / s.totalCount) * 100) : 0;
  return C.indigo(`${pct}% enriched`);
}

export function freshnessSegment(s: Stats): string {
  if (s.syncing) return C.amber('syncing…');
  if (s.dirty && s.staleCount > 0) return C.amber(`⚠ ${s.staleCount} stale`);
  if (s.dirty) return C.amber('⚠ stale');
  return C.indigo('✓ synced');
}

export function renderStatusline(
  stats: Stats | null,
  _session: SessionState | null,
  ctx: { ctxPct: number | null },
): string[] {
  if (!stats || stats.nodeCount === 0) {
    return [C.muted('◤ graft · not built · run ') + C.text('graft build')];
  }
  const top = [C.muted('◤ ') + C.indigo('graft'), C.text(`${stats.nodeCount} nodes / ${stats.edgeCount} edges`)];
  const enr = enrichedSegment(stats);
  if (enr) top.push(enr);
  top.push(freshnessSegment(stats));

  const bottom: string[] = [];
  if (typeof ctx.ctxPct === 'number') bottom.push(C.text(`ctx ${ctx.ctxPct}%`));
  if (stats.lastFile) bottom.push(C.muted('last: ') + C.text(basename(stats.lastFile)));

  const lines = [top.join(SEP)];
  if (bottom.length) lines.push(C.muted('▸ ') + bottom.join(SEP));
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the statusline entry**

```ts
// src/claude/statusline.ts
import { readFileSync } from 'node:fs';
import { renderStatusline } from './format.js';
import { readStats, readSession } from './state.js';

export function main(): void {
  let input: any = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/invalid stdin */ }
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const stats = readStats(dir);
  const session = readSession(dir, input.session_id || 'default');
  const raw = input?.context_window?.used_percentage;
  const ctxPct = typeof raw === 'number' ? Math.round(raw) : null;
  process.stdout.write(renderStatusline(stats, session, { ctxPct }).join('\n'));
}
```

- [ ] **Step 6: Write the shim**

```js
// .claude/helpers/graft-statusline.cjs
#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
import(path.join(dir, 'dist', 'claude', 'statusline.js'))
  .then((m) => m.main())
  .catch(() => { /* graft not built or unavailable — render nothing */ });
```

- [ ] **Step 7: Write `.claude/settings.json`**

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs\""
  }
}
```

- [ ] **Step 8: Build and smoke-test the shim end-to-end**

```bash
npm run build
echo '{"session_id":"t","cwd":"'"$PWD"'","context_window":{"used_percentage":34}}' \
  | node .claude/helpers/graft-statusline.cjs
```
Expected: a line like `◤ graft · 319 nodes / 730 edges · ✓ synced` then `▸ ctx 34%` (no `stats.json` yet → falls back to "not built"; that's fine — after Task 5 a real build populates it. To see the full bar now, run: `node -e "const{writeStats,emptyStats}=require('./dist/claude/state.js');writeStats(process.cwd(),{...emptyStats(),nodeCount:319,edgeCount:730,totalCount:319})"` then re-run the pipe).

> `require('./dist/claude/state.js')` in that one-liner works because Node 20+ allows `require()` of ESM without top-level await.

- [ ] **Step 9: Commit**

```bash
git add src/claude/format.ts src/claude/statusline.ts test/claude-format.test.ts \
  .claude/helpers/graft-statusline.cjs .claude/settings.json
git commit -m "feat(claude): statusline reader + shim + settings"
```

---

## Task 4: Post-edit hook — drift flag + blast-radius injection

**Files:**
- Modify: `src/claude/format.ts` (add `incomingEdges`, `formatBlastRadius`)
- Create: `src/claude/hooks.ts`, `.claude/helpers/graft-hooks.cjs`
- Modify: `.claude/settings.json` (add `PostToolUse`)
- Test: `test/claude-format.test.ts` (add cases), `test/claude-hooks.test.ts`

**Interfaces:**
- Consumes: `readWiring` (stats.ts); `patchStats` (state.ts); `GraphV1`, `EdgeV1` (src/graph/types.ts).
- Produces (format.ts): `incomingEdges(w:GraphV1, filePath:string): EdgeV1[]`; `formatBlastRadius(w:GraphV1, filePath:string, cap?:number): string|null`
- Produces (hooks.ts): `main(event:string): Promise<void>`; `underGraft(dir:string, file:string): boolean` (exported for test)

- [ ] **Step 1: Write the failing test for blast-radius**

```ts
// append to test/claude-format.test.ts
import { incomingEdges, formatBlastRadius } from '../src/claude/format.js';

const wiring2 = {
  meta: { nodeCount: 3, edgeCount: 2, languages: ['typescript'] },
  nodes: [
    { id: 'src/pkce.ts#verify', name: 'verify', path: 'src/pkce.ts', summary_state: 'ready' },
    { id: 'src/client.ts#exchange', name: 'exchange', path: 'src/client.ts', summary_state: 'ready' },
    { id: 'src/pkce.ts#gen', name: 'gen', path: 'src/pkce.ts', summary_state: 'ready' },
  ],
  edges: [
    { source: 'src/client.ts#exchange', target: 'src/pkce.ts#verify', relation: 'calls', confidence: 'extracted' },
    { source: 'src/pkce.ts#gen', target: 'src/pkce.ts#verify', relation: 'calls', confidence: 'extracted' },
  ],
} as any;

test('incomingEdges: external callers of nodes in the edited file', () => {
  const e = incomingEdges(wiring2, '/abs/repo/src/pkce.ts');
  assert.equal(e.length, 1, 'same-file edge (gen→verify) excluded');
  assert.equal(e[0].source, 'src/client.ts#exchange');
});

test('formatBlastRadius renders callers or null', () => {
  const txt = formatBlastRadius(wiring2, '/abs/repo/src/pkce.ts');
  assert.match(strip(txt!), /blast radius for pkce\.ts/);
  assert.match(strip(txt!), /exchange \(client\.ts\)/);
  assert.equal(formatBlastRadius(wiring2, '/abs/repo/src/unknown.ts'), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: FAIL — `incomingEdges`/`formatBlastRadius` not exported.

- [ ] **Step 3: Add blast-radius to `format.ts`**

```ts
// append to src/claude/format.ts
import type { GraphV1, EdgeV1 } from '../graph/types.js';

function nodeIdsInFile(w: GraphV1, filePath: string): Set<string> {
  const nodes = w.nodes ?? [];
  return new Set(
    nodes.filter((n) => n.path && (filePath === n.path || filePath.endsWith(`/${n.path}`) || filePath.endsWith(n.path)))
      .map((n) => n.id),
  );
}

export function incomingEdges(w: GraphV1, filePath: string): EdgeV1[] {
  const ids = nodeIdsInFile(w, filePath);
  if (!ids.size) return [];
  return (w.edges ?? []).filter((e) => ids.has(e.target) && !ids.has(e.source));
}

export function formatBlastRadius(w: GraphV1, filePath: string, cap = 8): string | null {
  const edges = incomingEdges(w, filePath);
  if (!edges.length) return null;
  const byId = new Map((w.nodes ?? []).map((n) => [n.id, n]));
  const items = edges.slice(0, cap).map((e) => {
    const n = byId.get(e.source);
    const label = n ? `${n.name} (${basename(n.path)})` : e.from;
    return ` • ${e.relation} ← ${label}`;
  });
  const more = edges.length > cap ? `\n • +${edges.length - cap} more` : '';
  return `[graft] blast radius for ${basename(filePath)} — who depends on it:\n${items.join('\n')}${more}`;
}
```

- [ ] **Step 4: Run to verify format tests pass**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Write the failing hooks test**

```ts
// test/claude-hooks.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { underGraft, main } from '../src/claude/hooks.js';
import { readStats } from '../src/claude/state.js';

test('underGraft detects edits inside graft/', () => {
  assert.equal(underGraft('/repo', '/repo/graft/x.md'), true);
  assert.equal(underGraft('/repo', '/repo/src/cli.ts'), false);
});

test('post-edit marks dirty and records lastFile', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeFileSync(join(d, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }));
  // graft check will fail (no dist/cli.js here) → staleCount falls back to 0, but dirty must still be set.
  process.env.CLAUDE_PROJECT_DIR = d;
  const stdin = JSON.stringify({ tool_input: { file_path: join(d, 'src', 'auth.ts') } });
  await runWithStdin(stdin, () => main('post-edit'));
  const s = readStats(d)!;
  assert.equal(s.dirty, true);
  assert.equal(s.lastFile, 'auth.ts');
});

test('post-edit ignores edits inside graft/', async () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-hooks-'));
  process.env.CLAUDE_PROJECT_DIR = d;
  await runWithStdin(JSON.stringify({ tool_input: { file_path: join(d, 'graft', 'a.md') } }), () => main('post-edit'));
  assert.equal(readStats(d), null, 'no state written for graft/ edits');
});

// helper: hooks.ts reads process.env.GRAFT_TEST_STDIN first (test seam), else fd 0.
async function runWithStdin(text: string, fn: () => Promise<void>): Promise<void> {
  process.env.GRAFT_TEST_STDIN = text;
  try { await fn(); } finally { delete process.env.GRAFT_TEST_STDIN; }
}
```

> Testing stdin is awkward, so `hooks.ts` reads `process.env.GRAFT_TEST_STDIN` first (test seam), then falls back to fd 0. This keeps tests hermetic without spawning subprocesses.

- [ ] **Step 6: Run to verify it fails**

Run: `node --import tsx --test test/claude-hooks.test.ts`
Expected: FAIL — cannot find `../src/claude/hooks.js`.

- [ ] **Step 7: Write `hooks.ts` (post-edit + stop stub + dispatcher)**

```ts
// src/claude/hooks.ts
import { readFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { join, basename } from 'node:path';
import { readWiring } from './stats.js';
import { formatBlastRadius } from './format.js';
import { patchStats, readStats, acquireLock } from './state.js';

function readStdin(): any {
  const seam = process.env.GRAFT_TEST_STDIN;
  const raw = seam !== undefined ? seam : safeReadFd0();
  try { return JSON.parse(raw); } catch { return {}; }
}
function safeReadFd0(): string { try { return readFileSync(0, 'utf8'); } catch { return ''; } }

function projectDir(input: any): string {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}
export function underGraft(dir: string, file: string): boolean {
  const rel = file.startsWith(dir) ? file.slice(dir.length) : file;
  return rel.replace(/^[/\\]+/, '').replace(/\\/g, '/').startsWith('graft/');
}
function graftJson(dir: string, args: string[]): any | null {
  try {
    const out = execFileSync(process.execPath, [join(dir, 'dist', 'cli.js'), ...args],
      { cwd: dir, encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(out);
  } catch { return null; }
}
function checkStaleCount(dir: string): number {
  const r = graftJson(dir, ['check', '.', '--json']);
  const g = r?.graph ?? {};
  return (g.changed?.length ?? 0) + (g.added?.length ?? 0) + (g.removed?.length ?? 0);
}
function emit(eventName: string, additionalContext: string): void {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext } }));
}

export async function main(event: string): Promise<void> {
  const input = readStdin();
  const dir = projectDir(input);

  if (event === 'post-edit') {
    const file: string | undefined = input?.tool_input?.file_path;
    if (!file || underGraft(dir, file)) return;
    patchStats(dir, { dirty: true, staleCount: checkStaleCount(dir), lastFile: basename(file) });
    const w = readWiring(dir);
    if (w) { const br = formatBlastRadius(w, file); if (br) emit('PostToolUse', br); }
    return;
  }

  if (event === 'stop') {
    const stats = readStats(dir);
    if (stats?.dirty && acquireLock(dir)) {
      patchStats(dir, { syncing: true });
      const child = spawn(process.execPath, [join(dir, 'dist', 'claude', 'sync-run.js'), dir],
        { detached: true, stdio: 'ignore' });
      child.unref();
    }
    return;
  }
}
```

- [ ] **Step 8: Run to verify hooks tests pass**

Run: `node --import tsx --test test/claude-hooks.test.ts`
Expected: PASS (3 tests). (The `stop` path isn't exercised until Task 5; `sync-run.js` spawn is guarded by the lock + dirty check.)

- [ ] **Step 9: Write the hooks shim**

```js
// .claude/helpers/graft-hooks.cjs
#!/usr/bin/env node
const path = require('path');
const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
import(path.join(dir, 'dist', 'claude', 'hooks.js'))
  .then((m) => m.main(process.argv[2]))
  .catch(() => { /* best-effort: never disrupt the session */ });
```

- [ ] **Step 10: Add `PostToolUse` to `.claude/settings.json`**

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs\""
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs\" post-edit", "timeout": 10000 }
        ]
      }
    ]
  }
}
```

- [ ] **Step 11: Build and commit**

```bash
npm run build
git add src/claude/format.ts src/claude/hooks.ts test/claude-format.test.ts test/claude-hooks.test.ts \
  .claude/helpers/graft-hooks.cjs .claude/settings.json
git commit -m "feat(claude): post-edit hook — drift flag + blast-radius injection"
```

---

## Task 5: Auto-sync — background rebuild runner (closes the loop)

**Files:**
- Create: `src/claude/sync-run.ts`
- Modify: `.claude/settings.json` (add `Stop`)
- Test: `test/claude-hooks.test.ts` (add sync-run behavior test)

**Interfaces:**
- Consumes: `readWiring`, `computeStats` (stats.ts); `patchStats`, `releaseLock` (state.ts).
- Produces: `src/claude/sync-run.ts` with `runSync(dir:string, build:(d:string)=>void): void` (build injected for testability) and a `main()` that calls `runSync` with the real `graft build`.

- [ ] **Step 1: Write the failing test (inject a fake build)**

```ts
// append to test/claude-hooks.test.ts
import { runSync } from '../src/claude/sync-run.js';
import { writeStats, emptyStats, acquireLock } from '../src/claude/state.js';

test('runSync clears dirty/syncing, recomputes stats, releases lock', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-'));
  mkdirSync(join(d, 'graft', '.graph'), { recursive: true });
  writeStats(d, { ...emptyStats(), dirty: true, syncing: true, staleCount: 3 });
  acquireLock(d);
  // fake build: write a fresh wiring.json with 2 nodes, 1 ready
  const fakeBuild = (dir: string) => writeFileSync(join(dir, 'graft', '.graph', 'wiring.json'),
    JSON.stringify({ meta: { nodeCount: 2, edgeCount: 1, languages: ['typescript'] },
      nodes: [{ id: 'a', summary_state: 'ready' }, { id: 'b', summary_state: 'pending' }],
      edges: [{ from: 'a', to: 'b' }] }));
  runSync(d, fakeBuild);
  const s = readStats(d)!;
  assert.equal(s.dirty, false);
  assert.equal(s.syncing, false);
  assert.equal(s.staleCount, 0);
  assert.equal(s.nodeCount, 2);
  assert.equal(s.readyCount, 1);
  assert.ok(s.syncedAt);
  assert.equal(acquireLock(d), true, 'lock released, so reacquire succeeds');
});

test('runSync clears syncing even if build throws (money-safe failure)', () => {
  const d = mkdtempSync(join(tmpdir(), 'graft-sync-'));
  writeStats(d, { ...emptyStats(), dirty: true, syncing: true });
  acquireLock(d);
  runSync(d, () => { throw new Error('build failed'); });
  const s = readStats(d)!;
  assert.equal(s.syncing, false);
  assert.equal(s.dirty, true, 'stays dirty so the bar keeps ⚠ and it retries next turn');
  assert.equal(acquireLock(d), true, 'lock always released');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/claude-hooks.test.ts`
Expected: FAIL — cannot find `../src/claude/sync-run.js`.

- [ ] **Step 3: Write `sync-run.ts`**

```ts
// src/claude/sync-run.ts
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { readWiring, computeStats } from './stats.js';
import { patchStats, releaseLock } from './state.js';

/** MONEY GUARD: plain `graft build` only — structural, $0, offline. Never --deep. */
function realBuild(dir: string): void {
  execFileSync(process.execPath, [join(dir, 'dist', 'cli.js'), 'build', '.'],
    { cwd: dir, stdio: 'ignore', timeout: 120000 });
}

export function runSync(dir: string, build: (d: string) => void = realBuild): void {
  try {
    build(dir);
    const w = readWiring(dir);
    const patch: Record<string, unknown> = { dirty: false, staleCount: 0, syncing: false, syncedAt: new Date().toISOString() };
    if (w) Object.assign(patch, computeStats(w));
    patchStats(dir, patch);
  } catch {
    patchStats(dir, { syncing: false }); // leave dirty=true; retry next turn
  } finally {
    releaseLock(dir);
  }
}

export function main(): void {
  const dir = process.argv[2];
  if (dir) runSync(dir);
}
main();
```

> `main()` runs on import so the detached `node dist/claude/sync-run.js <dir>` process (spawned by the `stop` hook in Task 4) executes `runSync` and exits. The `build` parameter default is the real, `--deep`-free build; tests inject a fake.

- [ ] **Step 4: Run to verify sync tests pass**

Run: `node --import tsx --test test/claude-hooks.test.ts`
Expected: PASS (5 tests total in this file).

- [ ] **Step 5: Add `Stop` to `.claude/settings.json`**

Add this key alongside `PostToolUse` inside `hooks`:

```json
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs\" stop", "timeout": 8000 }
        ]
      }
    ]
```

- [ ] **Step 6: Build, then verify the full loop end-to-end (money-safe)**

```bash
npm run build
# 1) simulate an edit → expect dirty + a stale count
echo '{"cwd":"'"$PWD"'","tool_input":{"file_path":"'"$PWD"'/src/cli.ts"}}' \
  | node .claude/helpers/graft-hooks.cjs post-edit
node -e "console.log(require('./dist/claude/state.js').readStats(process.cwd()))"   # dirty:true
# 2) simulate turn end → spawns background sync (plain build, $0)
echo '{"cwd":"'"$PWD"'"}' | node .claude/helpers/graft-hooks.cjs stop
sleep 5
node -e "console.log(require('./dist/claude/state.js').readStats(process.cwd()))"   # dirty:false, syncedAt set
```
Expected: after the sleep, `dirty:false`, `syncing:false`, `syncedAt` populated. Confirm **no** OpenRouter/network call happened (plain build only). Then `git checkout graft/` if the build rewrote committed graph files during this manual test.

- [ ] **Step 7: Commit**

```bash
git add src/claude/sync-run.ts test/claude-hooks.test.ts .claude/settings.json
git commit -m "feat(claude): turn-end auto-sync — detached \$0 rebuild under lock (never --deep)"
```

---

## Task 6: Active retrieval — inject graft matches on each prompt

**Files:**
- Modify: `src/claude/format.ts` (add `formatRetrieval`), `src/claude/hooks.ts` (add `prompt` event), `.claude/settings.json` (add `UserPromptSubmit`)
- Test: `test/claude-format.test.ts` (add cases)

**Interfaces:**
- Consumes: `graftJson` (internal to hooks.ts); `readSession`/`writeSession` (state.ts).
- Produces (format.ts): `interface AskJson { query:string; mode:string; hits:{kind:string;title:string;pointer:string;snippet:string;score:number}[] }`; `formatRetrieval(ask:AskJson, cap?:number): string|null`

- [ ] **Step 1: Write the failing test**

```ts
// append to test/claude-format.test.ts
import { formatRetrieval } from '../src/claude/format.js';

test('formatRetrieval renders top hits, trims snippet, first pointer only', () => {
  const ask = { query: 'pkce', mode: 'lexical', hits: [
    { kind: 'concept', title: 'PKCE', pointer: 'src/pkce.ts, src/client.ts', snippet: 'Validates   the   challenge.', score: 1 },
  ] } as any;
  const txt = strip(formatRetrieval(ask)!);
  assert.match(txt, /relevant context/);
  assert.match(txt, /PKCE — src\/pkce\.ts — Validates the challenge\./);
  assert.doesNotMatch(txt, /client\.ts/); // only the first pointer segment
});

test('formatRetrieval returns null for no hits', () => {
  assert.equal(formatRetrieval({ query: 'x', mode: 'empty', hits: [] } as any), null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: FAIL — `formatRetrieval` not exported.

- [ ] **Step 3: Add `formatRetrieval` to `format.ts`**

```ts
// append to src/claude/format.ts
export interface AskJson {
  query: string; mode: string;
  hits: { kind: string; title: string; pointer: string; snippet: string; score: number }[];
}

export function formatRetrieval(ask: AskJson, cap = 5): string | null {
  const hits = (ask.hits ?? []).slice(0, cap);
  if (!hits.length) return null;
  const lines = hits.map((h) => {
    const ptr = (h.pointer ?? '').split(',')[0].trim();
    const snip = (h.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return ` • ${h.title} — ${ptr} — ${snip}`;
  });
  return `[graft] relevant context for this prompt:\n${lines.join('\n')}`;
}
```

- [ ] **Step 4: Run to verify format tests pass**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Add the `prompt` branch to `hooks.ts`**

Insert before the closing of `main`, after the `stop` block:

```ts
  if (event === 'prompt') {
    const prompt = String(input?.prompt ?? '').trim();
    if (prompt.length < 8) return;
    const ask = graftJson(dir, ['ask', prompt, '.', '--json', '-n', '5']);
    if (!ask) return;
    const txt = formatRetrieval(ask);
    if (!txt) return;
    emit('UserPromptSubmit', txt);
    const id = input.session_id || 'default';
    const s = readSession(dir, id);
    s.lastQuery = prompt;
    const agent = input?.agent?.name;
    if (agent) s.perAgentQuery[agent] = prompt;
    writeSession(dir, id, s);
  }
```

Add to the imports at the top of `hooks.ts`:

```ts
import { formatBlastRadius, formatRetrieval } from './format.js';
import { patchStats, readStats, acquireLock, readSession, writeSession } from './state.js';
```

- [ ] **Step 6: Add `UserPromptSubmit` to `.claude/settings.json`** (inside `hooks`)

```json
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs\" prompt", "timeout": 8000 }
        ]
      }
    ]
```

- [ ] **Step 7: Build and smoke-test**

```bash
npm run build
echo '{"cwd":"'"$PWD"'","session_id":"t","prompt":"how does pkce verification work"}' \
  | node .claude/helpers/graft-hooks.cjs prompt
```
Expected: JSON with `hookSpecificOutput.additionalContext` containing `[graft] relevant context…` and real hits from this repo.

- [ ] **Step 8: Commit**

```bash
git add src/claude/format.ts src/claude/hooks.ts test/claude-format.test.ts .claude/settings.json
git commit -m "feat(claude): active retrieval — inject graft ask matches on prompt"
```

---

## Task 7: Session orientation — inject the repo map at session start

**Files:**
- Modify: `src/claude/format.ts` (add `formatOrientation`), `src/claude/hooks.ts` (add `session-start`), `.claude/settings.json` (add `SessionStart`)
- Test: `test/claude-format.test.ts` (add case)

**Interfaces:**
- Produces (format.ts): `formatOrientation(indexMd:string, budgetBytes?:number): string`

- [ ] **Step 1: Write the failing test**

```ts
// append to test/claude-format.test.ts
import { formatOrientation } from '../src/claude/format.js';

test('formatOrientation labels and truncates to budget', () => {
  const md = 'X'.repeat(3000);
  const out = strip(formatOrientation(md, 1500));
  assert.match(out, /repo map/);
  assert.ok(out.length < 1600, 'trimmed to budget + short header');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: FAIL — `formatOrientation` not exported.

- [ ] **Step 3: Add `formatOrientation` to `format.ts`**

```ts
// append to src/claude/format.ts
export function formatOrientation(indexMd: string, budgetBytes = 1500): string {
  return `[graft] repo map (graft/INDEX.md):\n${indexMd.slice(0, budgetBytes)}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Add the `session-start` branch to `hooks.ts`**

Add import at top: `import { readFileSync } from 'node:fs';` is already present. Add `formatOrientation` to the format import:

```ts
import { formatBlastRadius, formatRetrieval, formatOrientation } from './format.js';
```

Add the branch inside `main`:

```ts
  if (event === 'session-start') {
    try {
      const idx = readFileSync(join(dir, 'graft', 'INDEX.md'), 'utf8');
      emit('SessionStart', formatOrientation(idx));
    } catch { /* no INDEX.md — skip */ }
  }
```

- [ ] **Step 6: Add `SessionStart` to `.claude/settings.json`** (inside `hooks`)

```json
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-hooks.cjs\" session-start", "timeout": 8000 }
        ]
      }
    ]
```

- [ ] **Step 7: Build, smoke-test, commit**

```bash
npm run build
echo '{"cwd":"'"$PWD"'"}' | node .claude/helpers/graft-hooks.cjs session-start   # expect INDEX.md head in additionalContext
git add src/claude/format.ts src/claude/hooks.ts test/claude-format.test.ts .claude/settings.json
git commit -m "feat(claude): session-start orientation — inject graft/INDEX.md head"
```

---

## Task 8: Display extras — per-subagent row + clickable node refs

**Files:**
- Modify: `src/claude/statusline.ts` (per-agent line when `agent.name` present), `.claude/settings.json` (add `subagentStatusLine` + `footerLinksRegexes`)
- Test: `test/claude-format.test.ts` (add per-agent render case)

**Interfaces:**
- Consumes: `renderStatusline`, `readSession`.
- Produces (format.ts): `renderSubagent(agentName:string, session:SessionState|null): string`

- [ ] **Step 1: Write the failing test**

```ts
// append to test/claude-format.test.ts
import { renderSubagent } from '../src/claude/format.js';

test('renderSubagent shows agent name and its last query', () => {
  const out = strip(renderSubagent('Explore', { lastQuery: null, perAgentQuery: { Explore: 'pkce flow' }, graftReads: 0, sourceReads: 0 }));
  assert.match(out, /Explore/);
  assert.match(out, /pkce flow/);
});

test('renderSubagent without a query still shows the agent', () => {
  const out = strip(renderSubagent('Plan', null));
  assert.match(out, /Plan/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: FAIL — `renderSubagent` not exported.

- [ ] **Step 3: Add `renderSubagent` to `format.ts`**

```ts
// append to src/claude/format.ts
export function renderSubagent(agentName: string, session: SessionState | null): string {
  const q = session?.perAgentQuery?.[agentName];
  const tail = q ? SEP + C.muted('graft: ') + C.text(q) : '';
  return C.muted('◤ ') + C.indigo(agentName) + tail;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test test/claude-format.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Use it in `statusline.ts`**

Replace the body of `main` so it renders the subagent row when `agent.name` is set:

```ts
// src/claude/statusline.ts
import { readFileSync } from 'node:fs';
import { renderStatusline, renderSubagent } from './format.js';
import { readStats, readSession } from './state.js';

export function main(): void {
  let input: any = {};
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { /* no/invalid stdin */ }
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const session = readSession(dir, input.session_id || 'default');
  const agent = input?.agent?.name;
  if (agent) { process.stdout.write(renderSubagent(agent, session)); return; }
  const stats = readStats(dir);
  const raw = input?.context_window?.used_percentage;
  const ctxPct = typeof raw === 'number' ? Math.round(raw) : null;
  process.stdout.write(renderStatusline(stats, session, { ctxPct }).join('\n'));
}
```

> The same shim backs both `statusLine` and `subagentStatusLine`; the presence of `agent.name` on stdin selects the per-agent row. This keeps one entry point.

- [ ] **Step 6: Add `subagentStatusLine` + `footerLinksRegexes` to `.claude/settings.json`** (top level)

```json
  "subagentStatusLine": {
    "type": "command",
    "command": "node \"${CLAUDE_PROJECT_DIR:-.}/.claude/helpers/graft-statusline.cjs\""
  },
  "footerLinksRegexes": ["graft/[\\w./-]+\\.md"]
```

- [ ] **Step 7: Build, smoke-test, commit**

```bash
npm run build
echo '{"cwd":"'"$PWD"'","agent":{"name":"Explore"}}' | node .claude/helpers/graft-statusline.cjs   # expect "◤ Explore …"
git add src/claude/format.ts src/claude/statusline.ts test/claude-format.test.ts .claude/settings.json
git commit -m "feat(claude): per-subagent statusline row + clickable graft node refs"
```

---

## Task 9: Full suite green + dogfood verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `npm test`
Expected: all `test/*.test.ts` pass, including the four new `claude-*` files and the pre-existing engine tests (no regressions).

- [ ] **Step 2: Build clean**

Run: `npm run build`
Expected: exits 0; `dist/claude/{state,stats,format,statusline,hooks,sync-run}.js` all present (`ls dist/claude`).

- [ ] **Step 3: Dogfood the live loop in this repo**

In a Claude Code session opened on `context-graph-engine`:
1. Confirm the statusline shows `◤ graft · 319 nodes / 730 edges · ✓ synced` (once a real build has populated `stats.json`; run `graft build` once if needed).
2. Ask a question → confirm a `[graft] relevant context…` block was injected (visible in the transcript's context or via `/context`).
3. Edit a source file → statusline flips to `⚠ N stale`; a blast-radius note appears after the edit.
4. End the turn → within a few seconds the statusline returns to `✓ synced`.
5. **Money check:** confirm no OpenRouter request fired during auto-sync (structural build only). If `graft/` was rewritten by the manual build, `git add graft/` as an intended refresh or `git checkout graft/` to discard.

- [ ] **Step 4: Final commit (if any dogfood tweaks were needed)**

```bash
git add -A
git commit -m "chore(claude): verify full suite + dogfood the drift→sync loop"
```

---

## Notes for the implementer

- **Never** add `--deep` to any `graft build` invocation. The only build command in this plan is plain `graft build .` in `sync-run.ts`.
- The statusline path must never call `execFileSync`/`spawn` — it reads `stats.json`, one session file, and stdin. All Graft invocations live in `hooks.ts` / `sync-run.ts`, which fire on discrete events, not on every render.
- If `src/graph/types.ts` export names differ from those assumed in Task 2, match the file — do not invent types.
- All hooks are best-effort: the `.cjs` shims already swallow errors so a failure can never break the session.
