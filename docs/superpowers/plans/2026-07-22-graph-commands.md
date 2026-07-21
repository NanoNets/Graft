# Graph Commands (callers / callees / impact) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make graph traversal a first-class precise mode: `graft callers <symbol>`, `graft callees <symbol>`, `graft impact <symbol>` on the CLI and as MCP tools — the coupling-discovery capability benchmarks showed is the product's durable accuracy edge — and fix the silent/broken structural path inside `ask` using the same resolver.

**Architecture:** One new pure module `src/graph/traverse.ts` owns symbol resolution (qualified/dotted names, multi-match disambiguation) and edge walking over the loaded wiring graph (via the warm `loadGraphCached`). The CLI adds three commands with human + `--json` output. The MCP server gains `graft_callers`/`graft_callees` and upgrades `graft_blast_radius`→ depth-aware impact. `ask`'s structural intent path delegates subject resolution to the same resolver and reports empty results loudly ("no indexed callers — fall back to grep"), never as a silent stub.

**Tech Stack:** TypeScript ESM, Node ≥20, node:test + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies; ESM `.js` imports; files <500 lines.
- Symbol resolution contract (all commands share it): match against node `name` (case-insensitive) AND against id suffixes so qualified names work (`Cache.get` matches id `src/cache.ts#Cache.get`; `hashstructure.Hash` resolves by its last segment when the full form misses). Multiple matches are NOT an error: list every match with its `path:span` and traverse ALL of them, grouping output per match. An optional `--in <path-substring>` filter narrows candidates.
- Traversal edges: `calls`, `references`, `imports`, `implements`, `extends` (same set as graphrank's WALK_RELATIONS). `contains` is excluded.
- Empty results must be loud and actionable: state that the graph has no indexed edges for the symbol and suggest the fallback (`grep -rn "<name>"`), on stderr for CLI / in the text content for MCP. Never print a bare empty list.
- Reuse `loadGraphCached` (never readGraph directly) so MCP calls stay warm.
- Existing tests stay green; no behavior change to lexical ask.
- No third-party tool names anywhere.

---

## File Structure

- Create: `src/graph/traverse.ts` — `resolveSymbol`, `callersOf`, `calleesOf`, `impactOf` + types.
- Modify: `src/cli.ts` — three new commands.
- Modify: `src/mcp/tools.ts` — new/updated tools.
- Modify: `src/ask/ask.ts` — `structural()` uses `resolveSymbol`; loud empty handling (`note` field set; formatter prints it).
- Tests: `test/graph-traverse.test.ts`, extend `test/mcp-tools.test.ts`, extend `test/ask.test.ts` (structural cases only).

---

### Task 1: Traversal core (`src/graph/traverse.ts`)

**Interfaces:**
- `interface SymbolMatch { node: NodeV1 }`
- `resolveSymbol(graph: GraphV1, query: string, opts?: { in?: string }): NodeV1[]` — resolution contract from Global Constraints; excludes `kind: 'file'` nodes unless nothing else matches AND the query looks like a filename (contains `.` + no `#`).
- `interface EdgeHit { node: NodeV1 | null; id: string; relation: Relation; depth: number }` (`node` null for unresolved targets, e.g. external import strings — keep them, labeled by raw id)
- `callersOf(graph, symbol: NodeV1): EdgeHit[]` — nodes with an edge (walk relations) whose target is the symbol (depth 1).
- `calleesOf(graph, symbol: NodeV1): EdgeHit[]` — edges out of the symbol (depth 1).
- `impactOf(graph, symbol: NodeV1, maxDepth = 2): EdgeHit[]` — BFS over INCOMING walk edges up to maxDepth (who breaks if this changes), deduped by node id, each hit carrying the depth at first reach.

- [ ] **Step 1: failing tests** (`test/graph-traverse.test.ts`) with a hand-built fixture graph (nodeStub/graphOf helpers like test/graphrank.test.ts): resolution by bare name, case-insensitive; qualified `Class.method` via id suffix; last-segment fallback for `pkg.Fn`; `--in` filter; multi-match returns all; callers/callees correctness incl. unresolved import target (edge target id not in nodes → EdgeHit with node null); impact BFS depth 2 with dedup (diamond shape counted once, min depth), depth cap respected; empty results → [].
- [ ] **Step 2-4:** verify fail → implement → traverse tests + full suite green.
- [ ] **Step 5: Commit** — `feat(graph): traversal core — symbol resolution + callers/callees/impact`

### Task 2: CLI commands

- `graft callers <symbol> [dir] [--in <path>] [--json]`, `graft callees ...` (same shape), `graft impact <symbol> [dir] [-d <depth>] [--in <path>] [--json]`.
- Human output, per resolved match: header `<name> · <kind> · <path>:<span>` then one line per hit: `<relation> ← <name> (<path>:<span>)` for callers/impact (with `[depth N]` for impact), `→` direction for callees. Unresolved targets print the raw id with `(unresolved import)`.
- No matches for the symbol → stderr `✗ no symbol "<q>" in the graph — check spelling or run graft build` exit 1. Matches but zero edges → stdout header plus the loud empty note (`no indexed callers — the graph has no incoming call/reference edges for this symbol; try grep -rn "<name>"`), exit 0.
- `--json`: `{ query, matches: [{ symbol: {id,name,kind,path,span}, hits: [...] }] }`.
- [ ] Steps: failing CLI tests (execFileSync pattern from test/hosts-init.test.ts, on a built fixture repo — reuse the builtRepo helper pattern from test/mcp-tools.test.ts) covering: happy path callers, --json shape, unknown symbol exit 1, zero-edge loud note; implement; full suite; commit `feat(cli): graft callers / callees / impact commands`.

### Task 3: MCP tools + ask structural fix

- MCP: add `graft_callers` and `graft_callees` tools ({symbol, in?}); upgrade `graft_blast_radius` description + impl to `impactOf` with optional `depth` (default 2) while keeping the tool name (hosts already have it registered). All via `loadGraphCached`. Zero-edge results return the loud note text with `isError: false` (a true empty is an answer, but it must say what it means and suggest grep).
- `ask` structural path (`src/ask/ask.ts` `structural()`): replace `findSubject` with `resolveSymbol`; when intent matches (INCOMING/OUTGOING regexes) but subjects resolve to zero nodes OR zero edges, return an AskResult whose `note` says the structural index found nothing for the subject and the lexical results follow (then fall through to lexical instead of returning a bare empty structural result). `formatAsk` must surface the note prominently.
- [ ] Steps: failing tests (MCP: callers tool round-trip on fixture, blast_radius depth param; ask: "who calls <qualified.name>" resolves via suffix — the previously-broken case — and empty-structural falls through to lexical with the note); implement; FULL suite; commit `feat(mcp,ask): graph tools + loud structural fallback`.

## Out of scope
- Path-between-symbols, Go interface-satisfaction edges (future).
- README/skill updates — land with 0.4.4's guidance ship.

## Self-Review
- Resolution contract centralized once, consumed by 3 surfaces. ✓ Fixture-graph tests cover the dotted-name bug class directly. ✓ Loud-empty is specified for all 3 surfaces with distinct wording. ✓ No placeholder steps: interfaces fully typed above; test lists enumerate concrete cases. ✓
