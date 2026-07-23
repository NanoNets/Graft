# Scope-Aware Ranking (Multi-Root Workspaces) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the confirmed biggest-repo-drowns-everything bug (9/10 cross-repo queries return a 100% single-repo top-10) by making graft scope-aware — git boundaries decide where graphs live, project markers decide ranking partitions, per-scope statistics + reciprocal-rank fusion decide the merged ranking — with a hard guarantee that single-repo behavior, output, and latency are unchanged, and that existing graphs upgrade transparently on their next build.

**Architecture:** Two-level model. (1) A new `discoverScopes()` (generalizing build.ts's `readGoModules` walk) finds ranking scopes inside one graph via marker files (`package.json`, `go.mod`, `pyproject.toml`, workspace globs), with over-split guards; scopes persist as path prefixes in `GraphV1.meta.scopes` (node→scope = nearest-prefix lookup, no per-node field, old graphs = one scope = today's behavior). (2) `ask` partitions scoring by scope: per-scope IDF and per-scope PageRank (on the scope's subgraph), fused by reciprocal rank (RRF) with soft federation (only scopes that meaningfully match participate) and root-labeled output; when the graph has ≤1 scope the code takes the EXACT current path — byte-identical output. (3) A parent folder containing multiple git repos builds one graph per child (committable in each child) plus a workspace manifest at the parent; `ask`/`map`/`grep`/`check` at the parent federate over the child graphs with the same fusion machinery. Old mega-graphs at such parents are auto-split on the next build with a loud explanation.

**Tech Stack:** TypeScript ESM, Node ≥20, node:test + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies; ESM `.js` import specifiers; every file under 500 lines.
- **Zero single-repo regression (hard gate):** on a graph with ≤1 scope, `ask`/`map`/`grep`/`callers`/`impact`/MCP output must be BYTE-IDENTICAL to 0.5.0 (Task 7 automates this diff). The single-scope fast path must be an early branch, not "fusion with N=1".
- **Latency budgets (hard gates, Task 7):** single-repo warm `ask` within +10% of 0.5.0 on the same fixture; 3-repo colocated workspace `ask` ≤ 1.5× the largest member's solo ask; MCP warm-query behavior unchanged; `graft build` within +15% (discovery walk is one extra pass).
- **Upgrade transparency:** a 0.5.0 `wiring.json` (no `meta.scopes`) must load and behave exactly as today everywhere (loader treats missing scopes as `[{ prefix: "" }]`); the next `graft build` adds scopes with no user action; never require a manual migration command.
- **Philosophy:** wrong scope attribution is a wrong answer — every file belongs to exactly ONE scope, its nearest marker ancestor. Ambiguity in fusion drops toward current behavior, never invents ranking.
- Scope labels in output use the scope's directory path relative to the graph root (`frontend/`, `backend/`, or the repo dir name for workspace children); root scope (prefix `""`) is unlabeled — so single-repo output carries zero new text.
- Empty results stay loud; scope-related errors/notes enumerate available scopes (`--in frontend/ · backend/`).
- No third-party tool names anywhere in code/comments/docs/commits. NO Co-Authored-By trailers.
- Full suite green (`node --import tsx --test test/*.test.ts`, 278 at plan time) + `npm run build` before every commit.
- RRF constant K=60; soft-federation rule (exact, so tests are deterministic): a scope participates in fusion iff its best lexical score ≥ 0.25 × the global best lexical score AND it has ≥1 scoring doc. Non-participating scopes with ≥1 scoring doc are named in the "also matched" footer.

---

## File Structure

- Create: `src/graph/scopes.ts` — scope discovery (`discoverScopes`), scope assignment (`scopeOf`), workspace-child detection (`discoverWorkspaceChildren`), over-split guards. Pure functions + one fs walker.
- Modify: `src/graph/types.ts` — `meta.scopes?: ScopeV1[]` (additive); `src/graph/build.ts` — call discovery, populate meta, workspace-parent branch; `src/graph/write.ts` — nothing (spread already serializes meta).
- Create: `src/ask/fuse.ts` — pure rank fusion: partition docs by scope, RRF merge, soft-federation gate, `also matched` metadata.
- Modify: `src/ask/ask.ts` — the partition/fusion branch at the L439→L442 seam + `--in` pre-scoring filter + scope labels in hits/formatAsk; `src/ask/graphrank.ts` — accept an optional node-subset so per-scope walks run on subgraphs.
- Create: `src/graph/workspace.ts` — workspace manifest read/write (`graft/workspace.json` at the parent), federated multi-graph loading (via loadGraphCached per child).
- Modify: `src/cli.ts` (`ask --in`, workspace-aware command routing), `src/mcp/tools.ts` (`in` param on graft_ask; workspace federation), `src/graph/map.ts` (group by scope first), `src/claude/hooks.ts` (scope hint from lastFile), `src/claude/skill-template.ts` + `src/hosts/instructions.ts` (scope guidance), `README.md`.
- Tests: create `test/graph-scopes.test.ts`, `test/ask-fusion.test.ts`, `test/workspace.test.ts`, `test/regression-single-repo.test.ts`; extend `test/ask.test.ts`, `test/graph-map.test.ts`, `test/mcp-tools.test.ts`, `test/claude-skill-template.test.ts`, `test/hosts-instructions.test.ts`.

Task order: 1 (discovery+schema) → 2 (graphrank subset) → 3 (fusion in ask) → 4 (--in + UX) → 5 (workspace federation + migration) → 6 (surfaces: map/hooks/guidance/README) → 7 (regression + perf + skew acceptance harness).

---

### Task 1: Scope discovery + schema (`src/graph/scopes.ts`, `types.ts`, `build.ts`)

**Interfaces (produced — everything later consumes these exactly):**
```ts
// src/graph/types.ts — GraphV1.meta gains (additive, version stays 1):
meta: {
  version: 1; nodeCount: number; edgeCount: number; languages: string[];
  /** Ranking scopes: posix path prefixes relative to the graph root, "" = root scope.
   * Absent (old graphs) ≡ [{ prefix: "", label: "" }]. Sorted by prefix length desc. */
  scopes?: ScopeV1[];
};
// src/graph/types.ts
export interface ScopeV1 { prefix: string; label: string; markers: string[] }
```
```ts
// src/graph/scopes.ts
/** Walk the tree (reusing walkDir's skip rules) and find project-marker dirs. */
export function discoverScopes(root: string): ScopeV1[];
/** Nearest-prefix owner. scopes MUST be sorted prefix-length desc; "" matches all. */
export function scopeOf(path: string, scopes: ScopeV1[]): ScopeV1;
/** Immediate subdirs of root that are themselves git repos (have .git). Used by Task 5. */
export function discoverWorkspaceChildren(root: string): string[];
```

**Discovery rules (exact):**
1. Markers, checked per directory: `package.json`, `go.mod`, `pyproject.toml`, `setup.py`, `Cargo.toml`. A dir with ≥1 marker is a scope candidate; its prefix is the dir path posix-rel to root (`""` for root itself).
2. **Workspace-config-as-intent (over-split guard 1):** if the root has `pnpm-workspace.yaml`, or root `package.json` has a `workspaces` field, resolve those globs — the matched dirs are the ONLY sub-scopes considered from the JS family (individual `packages/*/package.json` deeper than the globs are ignored). Simple glob support: `dir/*` and `dir/**` forms only (implement with readdir, no dependency).
3. **Depth guard (over-split guard 2):** candidates deeper than 2 path segments below root are ignored unless matched by a workspace glob (rule 2).
4. **Nesting collapse:** a candidate whose prefix is inside another candidate's prefix is dropped (keep the shallower one) — except workspace-glob matches, which win over their parent.
5. **Minimum-substance guard (over-split guard 3):** after building the graph, a scope with < 5 non-file nodes is merged into the root scope (this runs in build.ts, since node counts aren't known at walk time).
6. If, after guards, exactly one scope remains (just root, or one marker dir == the whole repo), emit `scopes: [{ prefix: "", label: "", markers: [...] }]` — the canonical single-scope form.
7. `label` = prefix without trailing slash, or `""` for root. Deterministic ordering: prefix-length desc, then lexicographic.

**build.ts integration:** after `listSourceFiles` (L54-56 area), call `discoverScopes(root)`; apply guard 5 after node assembly; write to `meta.scopes` at the GraphV1 assembly (L128-137). `readGoModules` stays as-is (it feeds edge resolution, a different concern).

- [ ] **Step 1: failing tests** (`test/graph-scopes.test.ts`) — pure fs fixtures via mkdtemp:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverScopes, scopeOf, discoverWorkspaceChildren } from "../src/graph/scopes.js";

function fx(layout: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "scopes-"));
  for (const [p, content] of Object.entries(layout)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}

test("frontend/backend markers under one git root -> two scopes", () => {
  const d = fx({
    "frontend/package.json": "{}", "frontend/src/app.ts": "export const a = 1;",
    "backend/go.mod": "module m", "backend/main.go": "package main",
  });
  const scopes = discoverScopes(d);
  assert.deepEqual(scopes.map((s) => s.prefix).sort(), ["backend", "frontend"]);
  assert.equal(scopeOf("frontend/src/app.ts", scopes).label, "frontend");
  assert.equal(scopeOf("README.md", scopes).prefix, "");  // root scope always exists as fallback
  rmSync(d, { recursive: true, force: true });
});

test("workspace globs are intent: packages/* honored, deeper ignored", () => {
  const d = fx({
    "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
    "packages/core/package.json": "{}", "packages/core/i.ts": "1",
    "packages/cli/package.json": "{}", "packages/cli/i.ts": "1",
    "packages/cli/nested/package.json": "{}",  // deeper than glob -> ignored
  });
  const prefixes = discoverScopes(d).map((s) => s.prefix).sort();
  assert.deepEqual(prefixes, ["packages/cli", "packages/core"]);
  rmSync(d, { recursive: true, force: true });
});

test("root-only marker -> canonical single scope", () => {
  const d = fx({ "package.json": "{}", "src/a.ts": "1" });
  const scopes = discoverScopes(d);
  assert.deepEqual(scopes, [{ prefix: "", label: "", markers: ["package.json"] }]);
  rmSync(d, { recursive: true, force: true });
});

test("depth guard: markers 3 levels down ignored without workspace glob", () => {
  const d = fx({ "a/b/c/package.json": "{}", "src/x.ts": "1" });
  assert.equal(discoverScopes(d).length, 1); // root only
  rmSync(d, { recursive: true, force: true });
});

test("nesting collapse keeps shallower candidate", () => {
  const d = fx({ "svc/package.json": "{}", "svc/sub/package.json": "{}", "svc/i.ts": "1" });
  assert.deepEqual(discoverScopes(d).filter((s) => s.prefix).map((s) => s.prefix), ["svc"]);
  rmSync(d, { recursive: true, force: true });
});

test("discoverWorkspaceChildren finds immediate git children only", () => {
  const d = fx({ "repoA/x.ts": "1", "repoB/y.py": "1", "plain/z.go": "1" });
  mkdirSync(join(d, "repoA/.git"), { recursive: true });
  mkdirSync(join(d, "repoB/.git"), { recursive: true });
  mkdirSync(join(d, "repoB/vendored/.git"), { recursive: true }); // nested: not a child of d
  assert.deepEqual(discoverWorkspaceChildren(d).sort(), ["repoA", "repoB"]);
  rmSync(d, { recursive: true, force: true });
});
```

- [ ] **Step 2: verify fail. Step 3: implement scopes.ts** (walk with the same skip rules as `src/ingest/fs.ts` — import/reuse `SKIP_DIRS`; do not re-descend into dot-dirs) **+ types.ts meta field + build.ts wiring (incl. guard 5: merge scopes with <5 non-file nodes into root; a merged-away scope disappears from meta.scopes).**
- [ ] **Step 4: build-level test** (extend graph-scopes.test.ts): fixture with frontend(ts, 6 symbols)/backend(py, 6 symbols) under one dir → `buildGraph` → wiring.json meta.scopes has both prefixes; tiny scope (1 symbol) gets merged into root. Old-graph tolerance: hand-write a wiring.json WITHOUT meta.scopes, `loadGraphCached` + `scopeOf` fallback path returns root scope for everything (add a tiny `scopesOfGraph(graph): ScopeV1[]` helper in scopes.ts that defaults absent → `[{prefix:"",label:"",markers:[]}]` — everything downstream calls this, never touches meta directly).
- [ ] **Step 5: full suite green. Step 6: Commit** — `feat(graph): scope discovery — project markers become ranking scopes in graph meta`

---

### Task 2: Subgraph-capable PageRank (`src/ask/graphrank.ts`)

**Interfaces:** `personalizedPageRank(graph, seeds, opts?)` gains `opts.nodeFilter?: (id: string) => boolean`. When present: adjacency (L54-59) built only over edges whose BOTH endpoints pass the filter; rank vector and normalization (L95-100) restricted to passing ids. No filter → exact current behavior (regression: existing graphrank tests byte-stable).

- [ ] **Step 1: failing tests** (extend `test/graphrank.test.ts` with the existing nodeStub/graphOf helpers): (a) filter restricting to component A of a two-component fixture yields identical ranks to running on a graph containing only component A (build both, compare maps); (b) no filter → identical output to before (snapshot two-three known values from an existing test); (c) seeds outside the filter are ignored without error.
- [ ] **Step 2-4: verify fail → implement → full suite.**
- [ ] **Step 5: Commit** — `feat(ask): graphrank accepts a node filter for subgraph walks`

---

### Task 3: Per-scope ranking + RRF fusion in ask (`src/ask/fuse.ts`, `ask.ts`)

**Interfaces:**
```ts
// src/ask/fuse.ts — pure, no fs
export interface ScopedDoc { id: string; scope: string /* prefix */; score: number }
export interface FusionResult {
  /** fused order, best first; carries per-doc scope label + fused score in [0,1] */
  ranked: { id: string; scope: string; score: number }[];
  /** scopes that participated in fusion */
  federated: string[];
  /** scopes that matched weakly (≥1 scoring doc but below the participation gate) with their best doc */
  alsoMatched: { scope: string; bestId: string }[];
}
export const RRF_K = 60;
export const PARTICIPATION_RATIO = 0.25;
/** Partition by scope, rank within scope (input scores are already per-scope-normalized),
 * gate by soft federation, fuse by RRF: fused(id) = Σ 1/(K + rank_in_scope(id)). */
export function fuseScopes(docs: ScopedDoc[]): FusionResult;
```

**ask.ts integration (the seam at L439→L442, per recon):**
1. `const scopes = scopesOfGraph(graph)`; **if `scopes.length <= 1` → the ENTIRE existing code path runs untouched (early branch around everything below). This is the regression guarantee.**
2. Multi-scope: partition symbol docs by `scopeOf(node.path, scopes)`. Compute IDF **per scope** (same `computeIdf`/`computeIdfFromIndex` functions, fed only the scope's docs — extract the current calls into a helper taking a doc subset). Score lexically per scope (existing scoring functions, unchanged math). Run `personalizedPageRank` per participating scope with `nodeFilter = id -> scopeOf(nodeById(id).path) === scope`, seeds = that scope's lex map; blend per scope exactly as today (lexN + 0.5·pr, both already per-scope-normalized).
3. Feed per-scope blended lists to `fuseScopes`; take `ranked` as the symbol ordering. Concept docs (not path-partitionable the same way) keep their current scoring and merge as today by score — they're few and repo-level.
4. Hits carry `scope` label; `formatAsk` prefixes multi-scope hits with `[frontend/] ` and appends the footer: `matched in: frontend/ (6) · backend/ (3)` plus, when `alsoMatched` is nonempty, `also matched: docs/ — narrow with --in docs/`. Zero new output when single-scope.

- [ ] **Step 1: failing tests** — `test/ask-fusion.test.ts` (pure fuseScopes: two scopes 10-vs-2 docs → top-6 of fused contains both scopes' best; rank-1 tiny == rank-1 huge by construction (equal fused score); participation gate excludes a scope whose best is < 0.25 × global best but reports it in alsoMatched; single-scope input returns docs unchanged in order; determinism under input shuffle) + extend `test/ask.test.ts` with an end-to-end fixture: one tmp repo, `frontend/` (ts, contains `handleError` symbols) + `backend/` (py, contains `handle_error` symbols), backend 5× bigger; `ask "how are errors handled"` → top-10 contains ≥1 hit from each scope, hits labeled, footer present. And the regression pin: a single-scope fixture's `ask` output (full formatted string) equals the output captured with fusion code paths disabled (assert via the early-branch: run ask on a graph whose meta.scopes was hand-set to the canonical single form vs meta.scopes deleted — byte-equal).
- [ ] **Step 2-4: verify fail → implement → full suite green (existing ask tests must pass UNCHANGED — they're all single-scope).**
- [ ] **Step 5: Commit** — `feat(ask): per-scope ranking with reciprocal-rank fusion — big repos stop drowning small ones`

---

### Task 4: `ask --in` + scope-aware errors/empties

- `graft ask "<q>" [dir] --in <path-prefix>` filters docs BEFORE scoring (per-scope IDF/PR come free since the filter usually selects one scope; a mid-scope prefix like `--in backend/api` just filters docs). CLI flag copies the `--in` pattern from grep (cli.ts L270). MCP `graft_ask` gains `in?: string`.
- Unknown/no-match `--in` → exit 1: `✗ nothing indexed under "wrong/" — scopes here: frontend/ · backend/ (or any path prefix)`.
- Zero-hit ask on a multi-scope graph appends scope enumeration to the existing empty message.
- [ ] Steps: failing tests (extend test/ask.test.ts: --in filters to scope, per-scope idf actually differs from global (assert a term's rank changes vs unfiltered), unknown --in error wording + exit; MCP arg round-trip in test/mcp-tools.test.ts) → implement → full suite → commit `feat(ask): --in scope filter + scope-enumerating errors`.

---

### Task 5: Workspace federation (multi-git parents) + migration (`src/graph/workspace.ts`)

**Model:** parent dir P with ≥2 immediate git children and no own `.git` = a WORKSPACE. `graft build P`: builds each child's graph INTO THE CHILD (`<child>/graft/`, committable there, byte-identical to a standalone build), then writes `P/graft/workspace.json`:
```ts
export interface WorkspaceV1 { version: 1; children: string[] /* dir names, sorted */ }
```
No nodes/edges at the parent. `readWorkspace(dir): WorkspaceV1 | null`; `loadWorkspaceGraphs(dir)` → `{ child, graph }[]` via loadGraphCached on each child's graft (skip children without a built graph — count them and surface: `2 of 3 workspace repos have graphs; run graft build to cover repoC`).

**Federated commands at a workspace parent:** `ask` — run the full per-scope pipeline per child graph (each child is one-or-more scopes; scope label = `<child>/<scopePrefix>` or just `<child>/`), fuse ALL scope lists with the same fuseScopes; `map` — render one section per child (child graphs' own map data, budget split evenly); `grep` — search each child's indexed files, merge groups (in-degree from each child's own graph); `check` — per-child status lines, exit 1 if any present-and-stale; `callers`/`callees`/`impact` — resolve the symbol across children; if found in several, group output per child (traverse-cli already groups per match). MCP: the server rooted at a workspace federates identically.

**Migration (exact behavior):**
- A parent that HAS an old mega-graph (P/graft/.graph/wiring.json exists AND ≥2 git children detected): `graft build P` prints `⚠ this folder contains 2 separate git repos — splitting: each repo now gets its own committable graft/ (repoA/graft/, repoB/graft/); the combined graph here is replaced by a workspace index. Queries from here now search all repos, fairly.` — then builds children, writes workspace.json, and REPLACES P/graft/.graph + P/graft/.cache with the manifest (the mega graph is regenerable; child cards land in the children).
- A single git repo built with 0.5.0 (no meta.scopes): everything works as today via the `scopesOfGraph` fallback; next `graft build` adds scopes silently. NO forced rebuild: `ask` must never error on a scope-less graph.
- `graft check` at a stale-mega-graph parent (user hasn't rebuilt): works as today (it's still a valid graph) — migration only happens through build.

- [ ] **Step 1: failing tests** (`test/workspace.test.ts`): tmp parent with two tiny git children (mkdir .git) → build at parent → each child has graft/.graph/wiring.json identical (byte) to building that child standalone; workspace.json lists both; ask at parent returns hits from both children labeled `repoA/`/`repoB/`; ask inside a child = standalone behavior; mega-graph migration: pre-seed parent with a hand-built combined wiring.json → build → children built, parent .graph gone, workspace.json present, note text asserted; check federation exit codes; one-child-unbuilt surfacing.
- [ ] **Step 2-4: implement → full suite. Step 5: Commit** — `feat(workspace): multi-repo parents federate per-child graphs — auto-split replaces mega-graphs`

---

### Task 6: Surfaces — map by scope, hooks scope hint, guidance, README

- `map.ts`: when multi-scope, group by scope FIRST (scope label as the top-level group key via a scope-aware `dirKey`), dirs within scope second; workspace parents render per-child sections (from Task 5). Single-scope: unchanged output (regression).
- `hooks.ts`: the prompt hook passes `--in <scope>` when session state's `lastFile` (already captured at hooks.ts L54) resolves to a scope AND the graph is multi-scope — the "you're working in backend/, weight backend/" hint. Cheap, reversible, and only fires multi-scope.
- `skill-template.ts` + `instructions.ts` (ADDITIVE, existing phrasing untouched): one bullet — multi-repo folders and monorepos rank fairly across sub-projects; hits carry `[scope/]` labels; narrow with `ask --in <scope>/` when you know where you're working.
- README: a "Monorepos & multi-repo folders" section (the two cases from the design discussion, 6-8 lines, with the auto-split note) + `--in` row in the ask flags.
- [ ] Steps: failing tests (map multi-scope grouping + single-scope unchanged; hook passes --in when lastFile in scope — extend test/claude-hooks.test.ts with GRAFT_TEST_STDIN pattern; skill/instructions phrase assertions) → implement → full suite → commit `feat(surfaces): scope-aware map, hooks scope hint, guidance + docs`.

---

### Task 7: Regression, performance, and skew acceptance harness

This task is the user-mandated gate: **no regressions, latency held, upgrades smooth.** Everything is scripted and numbers land in the report.

- [ ] **Step 1: automated single-repo byte-regression test** (`test/regression-single-repo.test.ts`): build 3 single-repo fixtures (ts-only, py-only, mixed with root-only markers); for each, capture `ask` (plain/`--source`/`--json`), `map`, `grep`, `callers` outputs; assert non-empty and, for the ask JSON, assert scope fields are absent/root and no fusion footer text appears. Then the cross-version diff (scripted, not unit): `git worktree add <scratch>/v050 <0.5.0 tag/commit>` → build its dist → run the same fixture through 0.5.0 binary and new binary → **byte-diff the outputs** (allowing only the version string). Any diff = FAIL.
- [ ] **Step 2: latency gate** (script in scratchpad, numbers in report): (a) big single repo — the fastapi checkout at /private/tmp/claude-501/-Users-shrishdwivedi-Documents-Context-graphs/d3b217f7-4a78-4399-b91a-8bb7db720797/scratchpad/fastapi-accept: median-of-5 warm `ask` for 3 queries, new vs 0.5.0 worktree binary — gate: ≤ +10%; build time ≤ +15%. (b) colocated 3-repo workspace (rebuild the cobra+fastapi+p-queue fixture from the skew investigation at .../scratchpad/colocated): median-of-5 `ask` at the parent — gate: ≤ 1.5× fastapi-solo ask. (c) MCP: two graft_ask calls one session, second still cache-fast.
- [ ] **Step 3: skew acceptance** — rerun the original 10-query experiment from .../scratchpad/colocated/skew-report.md on the workspace: gates: ≥8/10 queries have ≥2 repos in the top-10 when ≥2 repos have participation-level matches; the "how are errors handled" query surfaces a cobra hit in the top-10 (was #78); repo-specific queries ("shell completion") still return their repo's hits at top (no over-diversification — assert top-3 all cobra).
- [ ] **Step 4: upgrade gates** — (a) 0.5.0-built fastapi graph queried by NEW binary without rebuild: works, no scope text, results sane; then `graft build` → meta.scopes appears → ask unchanged (fastapi is single-scope); (b) mega-graph parent auto-split end-to-end (from Task 5's test but with the real 3-repo workspace, timing the split build); (c) fastapi acceptance numbers hold: `callers include_router` = 110, sweep 7 groups, map <6000 chars.
- [ ] **Step 5: full suite + build; write all numbers into the task report. Commit** (any test-only files) — `test: cross-version regression, latency, and skew acceptance harness`.

## Out of scope (explicitly deferred)

- Cross-repo/cross-scope EDGES (manifest deps, HTTP contract matching) — 0.7 headline; this wave only makes ranking and surfaces scope-aware.
- Value-visibility wave (session ledger, `graft stats`) — separate small wave, planned next.
- Per-scope sidecar df precomputation (compute per-scope IDF at query time first; optimize only if Task 7's latency gate fails).
- Connectivity-based scope validation (edge-cluster sanity check) — revisit if marker-based detection misfires in the field.

## Self-Review

- Both field cases covered: monorepo (Case A: Tasks 1+3, one graph + scopes) and colocated repos (Case B: Task 5, per-child graphs + workspace manifest). ✓
- User's three hard requirements are Task 7 hard gates (byte-regression, latency budgets, upgrade transparency), not aspirations. ✓
- Single-scope early branch stated in three places (constraint, Task 3, Task 6) — the regression guarantee is structural. ✓
- No placeholders: discovery rules enumerated with exact guards; fusion math specified (RRF K=60, participation 0.25); migration wording written out; test code included for the tricky tasks. ✓
- Type consistency: `ScopeV1`/`scopesOfGraph`/`scopeOf` (Task 1) consumed by Tasks 3-6; `fuseScopes` shapes match ask.ts usage; `WorkspaceV1` matches Task 5 tests. ✓
