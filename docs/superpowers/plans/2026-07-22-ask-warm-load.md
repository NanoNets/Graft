# Ask Warm Load & Slim Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the redundant per-call load cost that dominates `ask` latency at scale: the MCP server stops re-parsing the graph on every tool call (warm ~0.3s queries), and `wiring.json` sheds its `body_text` payload (56MB → ~20MB on a 32k-node graph), cutting cold load for every consumer and shrinking the committed artifact ~3×.

**Architecture:** (1) A tiny mtime-keyed loader cache (`src/graph/load.ts`) wraps `readGraph` + `readAskIndex`; the MCP tools use it so a long-lived `graft mcp` process parses once per graph version. (2) `writeGraph` stops serializing `body_text` (the ask sidecar already carries those tokens); `ask`'s fallback path (no sidecar) keeps working via name/path/signature/summary and, for OLD graphs that still carry `body_text`, uses it as before. No schema version bump — the field was always optional.

**Tech Stack:** TypeScript ESM, Node ≥20, node:test + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies; ESM `.js` imports; files <500 lines.
- Ranking parity: on a graph WITH a sidecar, ask results must be byte-identical before/after slimming (the sidecar already provides body tokens). On a NEW slim graph WITHOUT a sidecar, ask must degrade gracefully (name/path/signature/summary matching), never crash.
- Old graphs (with body_text, with or without sidecar) keep working unchanged.
- Cache correctness beats speed: the loader must re-parse when the file's (mtime, size) changes; a stale cache serving old graph data is a bug.
- CLI one-shot behavior unchanged (cache is per-process; one-shot processes see no difference).
- No third-party tool names anywhere.
- Acceptance (measure and record in reports, big graph = 32,377 nodes at /private/tmp/claude-501/-Users-shrishdwivedi-Documents-Context-graphs/d3b217f7-4a78-4399-b91a-8bb7db720797/scratchpad/bigrepo-graft, repo /Users/shrishdwivedi/Documents/Nanonets/assign):
  - MCP `tools/call` graft_ask twice in one server session: 2nd call ≥3× faster than 1st.
  - After rebuild with slim wiring: wiring.json ≤ 25MB; cold `ask` ≤ 0.7s; 6-way concurrent asks ≤ 3s each.

---

## File Structure

- Create: `src/graph/load.ts` — `loadGraphCached(outDir)`, `loadAskIndexCached(outDir)` with (path, mtimeMs, size)-keyed memoization.
- Modify: `src/mcp/tools.ts` — use the cached loaders (ask needs the engine… see Task 1 notes: graft_blast_radius uses loadGraphCached; graft_ask flows through engine.ask which reads internally — Task 1 threads a preloaded graph/index through `ask()` opts, or exposes cache at the read layer; decide per the note).
- Modify: `src/graph/write.ts` — `writeGraph` drops `body_text` from serialized nodes.
- Modify: `src/ask/ask.ts` — fallback path tolerates absent body_text.
- Tests: `test/graph-load.test.ts`, extend `test/ask-index.test.ts` / `test/mcp-tools.test.ts`.

---

### Task 1: mtime-keyed loader cache + MCP warm path

**Files:**
- Create: `src/graph/load.ts`
- Modify: `src/mcp/tools.ts`, and the minimal seam in `src/ask/ask.ts` (see note)
- Test: `test/graph-load.test.ts`

**Interfaces:**
- `loadGraphCached(outDir: string): GraphV1 | null` — returns the parsed wiring graph; re-reads only when `(mtimeMs, size)` of the wiring file changed; returns null when missing (same semantics as `readGraph`).
- `loadAskIndexCached(outDir: string): AskIndex | null` — same for the sidecar (wraps `readAskIndex`).
- IMPLEMENTATION NOTE (resolve before coding): `engine.ask()` → `src/ask/ask.ts` currently reads wiring+index internally per call. Give `ask()` (and `Graft.ask`) an optional escape: read through the new cached loaders instead of direct `readGraph`/`readAskIndex` calls — i.e., replace ask.ts's internal read call sites with the cached loaders. That single change warms BOTH the CLI-in-one-process case and the MCP server, with zero API change. `callTool`'s `graft_blast_radius` likewise switches to `loadGraphCached`. The cache module must be dependency-free (fs + the two readers) to avoid cycles: load.ts imports from graph/write.js and ask/index-file.js only.
- Cache invalidation test is mandatory: build fixture graph → load (parse #1) → touch/rewrite wiring with a changed node → load again → new content visible. Track parse counts via an internal counter exported for tests (`__parseCount` or an injectable hook).

- [ ] **Step 1: Failing tests** (`test/graph-load.test.ts`): (a) two loads, same file → same object identity (or parseCount 1); (b) rewrite file (different content → different size/mtime; use `utimesSync` to force distinct mtime if needed) → reload picks up new content, parseCount 2; (c) missing file → null, and a later-created file is picked up; (d) MCP-level: spawn is overkill — instead unit-test that `callTool` twice on the same dir doesn't reparse (parseCount stable after first call), using the counter.
- [ ] **Step 2: Verify failure. Step 3: Implement. Step 4: Full suite green** (`node --import tsx --test test/*.test.ts`) — existing ask/mcp tests must pass unchanged (parity: cached loaders return identical data).
- [ ] **Step 5: Acceptance** — script an MCP session against the big graph: initialize → tools/call graft_ask → tools/call graft_ask again; record both wall times from the client side (expect 2nd ≥3× faster). Include numbers in the report.
- [ ] **Step 6: Commit** — `perf(ask): mtime-keyed graph/index cache — warm queries in long-lived processes`

---

### Task 2: Slim wiring.json (body_text moves out)

**Files:**
- Modify: `src/graph/write.ts` (strip `body_text` in `writeGraph` serialization — keep the in-memory type field optional/intact since build uses it to produce the sidecar BEFORE writing), `src/graph/build.ts` (ensure ordering: sidecar written from the in-memory graph that still has body_text; wiring written slim), `src/ask/ask.ts` (fallback tolerates absent body_text).
- Test: extend `test/ask-index.test.ts` + `test/graph-write` coverage wherever wiring round-trips are asserted.

**Interfaces:** unchanged public API. Behavior contract:
- New builds: wiring.json contains NO `body_text` on any node; sidecar carries the tokens (already true).
- `ask` WITH sidecar: results identical to pre-slim (assert by building a fixture pre-slim vs post-slim… simplest: assert post-slim ask results equal the sidecar-driven results from Task-set 2026-07-21, i.e. run lexical() with sidecar on slim graph vs with sidecar on fat graph — same hits/scores).
- `ask` WITHOUT sidecar on a SLIM graph: no crash; body field contributions are simply absent (signature+summary still tokenized); add an explicit test.
- `ask` on an OLD fat graph without sidecar: unchanged behavior (body_text used) — regression-guard with a fixture that injects body_text manually.
- `check`/`viz`/`cards` unaffected (verify by suite).

- [ ] **Step 1: Failing tests** for the four contract lines above. **Step 2-4: implement, full suite green.**
- [ ] **Step 5: Acceptance** — rebuild the big graph; record: wiring.json size (expect ~≤25MB from 56MB), cold `ask` wall time (expect ≤0.7s), and the 6-way concurrent run (expect ≤3s each; command pattern: six backgrounded `graft --dir <graph> ask "<q i>" <repo>` + wait, timed).
- [ ] **Step 6: Commit** — `perf(graph): slim wiring.json — body_text lives only in the ask index sidecar`

---

### Task 3: Verification & docs touch

- [ ] Full suite + build. Re-run acceptance trio (warm MCP, cold ask, concurrency) and tabulate before/after in the task report.
- [ ] README: if any wiring-size or latency claims exist, update; otherwise no doc change. Ledger updated.
- [ ] Commit only if files changed.

## Out of scope
- A standalone daemon (the MCP server IS the warm process; hooks stay one-shot with the now-halved cold cost).
- Sidecar format compaction (separate, lower-value).
- Convergence signals / ranking hygiene (0.5.0 milestone).

## Self-Review
- Cache staleness covered by mandatory invalidation test; identity of results guaranteed by routing through existing readers. ✓
- Slim-graph compat matrix has all four cells tested (sidecar × body_text presence). ✓
- Build-order hazard (sidecar must be generated from in-memory nodes BEFORE body_text is dropped at serialization — not from a re-read of slim wiring) explicitly called out in Task 2 files list. ✓
