# Typed Method Calls + Symbol-Grouped Grep + Repo Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close graft's biggest correctness gap (instance-method call edges dropped as ambiguous: 1 vs ~37 callers of `include_router` on fastapi) via a lightweight receiver-type binding pass for Python/TypeScript/TSX/Go; add `graft grep` (search grouped by enclosing symbol with in-degree); add `graft map` (compact deterministic repo orientation) — each on CLI + MCP — plus fix the `graft mcp --dir` override bug.

**Architecture:** (1) A per-file binding pass (`src/graph/bindings.ts`) collects variable→type bindings from constructor calls, annotations, and receiver declarations during extraction; `extract.ts` attaches the resolved receiver type to member-call raw edges (`recvType`); `resolve.ts` gains an owner-qualified method index (`Class.method`) plus a bounded `extends`-chain walk, so typed member calls resolve to the right class's method instead of being dropped as name-ambiguous. Untyped receivers keep today's drop-don't-guess behavior. (2) `graft grep` runs a regex over the graph's indexed files and groups hits by innermost enclosing symbol, ranked by incoming-edge count. (3) `graft map` renders a token-budgeted orientation (directory clusters, hubs, hotspots) from the wiring graph alone.

**Tech Stack:** TypeScript ESM, Node ≥20, tree-sitter (existing grammars only), node:test + tsx. No new dependencies.

## Global Constraints

- No new npm dependencies; ESM `.js` import specifiers; keep every file under 500 lines.
- Supported languages are exactly `typescript | tsx | python | go` (`languageOf` in src/graph/extract.ts). The binding pass must cover **all four** (tsx shares the TS shapes).
- Edge philosophy is inviolable: **never wire an edge to the wrong symbol**. Typed resolution may only ADD edges it is confident about (unique owner-qualified match, or same-file match); ambiguity at any step → drop, exactly like today. Untyped member calls keep current behavior bit-for-bit.
- Empty results stay loud and actionable (existing traverse-cli wording); `graft grep` and `graft map` must never print a bare empty list — say what was searched and suggest the fallback.
- All graph consumers read through `loadGraphCached` (src/graph/load.ts), never `readGraph` directly.
- No competitor/third-party tool names anywhere in code, comments, docs, or commit messages — describe patterns generically.
- Full suite green after every task: `node --import tsx --test test/*.test.ts` (216 tests pass at plan time). `npm run build` clean before each commit.
- Commit messages: NO Co-Authored-By trailer (project rule).
- Wiring schema: `EdgeV1 { source, target, relation, confidence: "extracted" | "inferred" }` — unchanged. `RawEdge` (extract-internal, never serialized) gains one optional field.
- MCP tool count assertions: test/mcp-tools.test.ts and the Gate-A style checks expect the tool list; update the expected list to exactly 7 tools when adding `graft_grep` and `graft_map`.

---

## File Structure

- Create: `src/graph/bindings.ts` — per-file receiver-type binding collection (pass 1 of extraction).
- Modify: `src/graph/extract.ts` — capture receiver text on member calls; look up `recvType` via bindings; track enclosing class.
- Modify: `src/graph/resolve.ts` — owner-qualified method index + `extends`-chain typed resolution.
- Create: `src/graph/relations.ts` — the shared `WALK_RELATIONS` set (currently duplicated in traverse.ts and graphrank.ts).
- Create: `src/search/grep.ts` — pure grep-and-group core; `src/search/grep-cli.ts` — CLI formatter + runner.
- Create: `src/graph/map.ts` — pure repo-map builder + formatter.
- Modify: `src/cli.ts` — register `grep` and `map` commands (file is 347 lines; the two registrations add ~30 — stays under 500).
- Modify: `src/mcp/tools.ts` — `--dir` bug fix; register `graft_grep` + `graft_map` (170 lines now; if additions push it past ~480, move the two new tool handlers into `src/mcp/tools-search.ts` and re-export).
- Modify: `src/claude/skill-template.ts`, `src/hosts/instructions.ts` — guidance: sweeps route to `graft grep`, first contact to `graft map`.
- Modify: `README.md` — command table + short sections.
- Tests: create `test/graph-bindings.test.ts`, `test/graph-resolve-typed.test.ts`, `test/search-grep.test.ts`, `test/graph-map.test.ts`; extend `test/mcp-tools.test.ts`, `test/claude-skill-template.test.ts`, `test/hosts-instructions.test.ts`.

Task order: 1 (bug fix) → 2 (bindings) → 3 (typed resolve + acceptance) → 4 (grep) → 5 (map) → 6 (guidance + README + final acceptance). Tasks 4 and 5 don't depend on 2–3 but come after so the acceptance in 6 measures everything together.

---

### Task 1: Fix `graft mcp` ignoring the global `--dir` override

Head-to-head testing found `graft mcp --dir <graphdir>` silently uses the default `graft/` dir: `src/mcp/tools.ts` calls `contextDirFor(root)` with no override (lines 130 and 154), while the CLI's other commands pass `globalOpts.dir` (see src/cli.ts:209, 332).

**Files:**
- Modify: `src/mcp/tools.ts` (the two `contextDirFor(root)` call sites + the exported factory signature)
- Modify: `src/cli.ts` (the `mcp` command action — find it with `grep -n "mcp" src/cli.ts` — must read `program.opts().dir` and pass it through)
- Test: extend `test/mcp-tools.test.ts`

**Interfaces:**
- Consumes: existing `contextDirFor(root: string, override?: string)` from src/context/node-file.ts (verify its signature first; cli.ts:209 shows it takes the override as 2nd arg).
- Produces: whatever function `src/mcp/tools.ts` exports to build the tool handlers (read the file top; likely a `createTools(root)` or similar) gains an optional `dirOverride?: string` parameter, threaded to every `contextDirFor` call.

- [ ] **Step 1: Write the failing test** — in test/mcp-tools.test.ts, using the existing builtRepo fixture pattern from that file: build a fixture repo whose graph lives in a NON-default dir (build with the CLI: `node --import tsx src/cli.ts build <repo> --dir <repo>/customgraph` — check `graft build --help` for the exact flag spelling used by the global option), then call the tools factory with the override and assert `graft_check`/`graft_callers` finds the graph; call it without the override and assert it reports no graph.
- [ ] **Step 2: Run it** — `node --import tsx --test test/mcp-tools.test.ts` → the override case FAILS (tools can't find the graph).
- [ ] **Step 3: Implement** — thread `dirOverride` through the tools factory into both `contextDirFor(root, dirOverride)` call sites; in src/cli.ts's mcp action, pass the program-level `--dir` value.
- [ ] **Step 4: Full suite green.**
- [ ] **Step 5: Commit** — `fix(mcp): honor the global --dir override for the graph location`

---

### Task 2: Receiver-type bindings (`src/graph/bindings.ts`) + extraction capture

The binding pass answers one question at each member call site: *what type is the receiver?* Sources of truth, all verified against the vendored grammars:

| Lang | Clue | Tree shape (verified) |
|---|---|---|
| py | `app = FastAPI()` | `assignment(left: identifier, right: call(function: identifier))` |
| py | `r: APIRouter = ...` / class field `q: Queue` | `assignment` with `type` field → `type(identifier)` |
| py | `def go(self, x: Item)` | `typed_parameter(identifier, type(identifier))` |
| py | `self.w = Worker()` in a method | `assignment(left: attribute(self, w), right: call(identifier))` — bind key `self.w` at class scope |
| py | `from fastapi import FastAPI as F` | `import_from_statement > aliased_import(dotted_name, identifier)` — alias map F→FastAPI |
| ts/tsx | `const app = new FastAPI()` | `variable_declarator(name: identifier, value: new_expression(constructor: identifier))` |
| ts/tsx | `let r: Router` / param `x: Item` / field `q: Queue` | `type_annotation > type_identifier` under `variable_declarator` / `required_parameter` / `public_field_definition` |
| ts/tsx | `q: Queue = new Queue()` class field | `public_field_definition(property_identifier, type_annotation, new_expression)` — bind key `this.q` at class scope |
| ts/tsx | `import { Router as R } from './r'` | `import_specifier(identifier name, identifier alias)` |
| go | `u := User{}` / `u := &User{}` | `short_var_declaration(expression_list(identifier), expression_list(composite_literal(type: type_identifier)))` (unary `&` wraps the composite_literal) |
| go | `var d *DB` | `var_spec(name: identifier, type: pointer_type(type_identifier) \| type_identifier)` |
| go | `s := NewServer()` | `short_var_declaration(..., call_expression(function: identifier))` — Go convention: `NewX(...)` binds to `X` (confidence handled in Task 3: this binding is convention-derived, still resolved unique-or-drop) |
| all | `self` / `this` / Go receiver var | NOT a binding-map entry — extract.ts maps it from the enclosing class / the method_declaration's receiver (existing `goReceiverType`) |

**Scope model:** bindings are collected in a single pre-order walk that mirrors extract.ts's scope stack. Store entries in a `Map<string, string>` keyed `` `${scopePath}|${name}` `` where `scopePath` is `scope.join(".")` (`""` at module level). Lookup walks the scope chain innermost→outermost (pop one segment at a time, ending at `""`). A later binding in the same scope overwrites an earlier one (last write wins — good enough; reassignment to a different type is rare and the failure mode is a dropped edge in Task 3, never a wrong one... note: it CAN produce a wrong-type lookup if a variable is reassigned mid-function and called in between; accepted as negligible for real code and bounded by unique-or-drop matching). `self.attr`/`this.attr` entries are stored with name `self.attr`/`this.attr` at the CLASS scope path.

**Files:**
- Create: `src/graph/bindings.ts` (~180 lines)
- Modify: `src/graph/extract.ts` — see integration below
- Test: create `test/graph-bindings.test.ts`

**Interfaces (produced — Task 3 and extract.ts rely on these exactly):**
```ts
// src/graph/bindings.ts
import type Parser from "tree-sitter";
import type { Language } from "./extract.js";

export class FileBindings {
  /** map: `${scopePath}|${name}` -> bare type name (aliases already resolved) */
  private map = new Map<string, string>();
  set(scopePath: string, name: string, type: string): void;
  /** innermost-first: tries `a.b|x`, `a|x`, `|x` for scope ["a","b"], name "x" */
  lookup(scope: string[], name: string): string | null;
}

/** Pass 1 over a parsed file: collect variable->type bindings. Pure. */
export function collectBindings(root: Parser.SyntaxNode, lang: Language): FileBindings;
```

```ts
// src/graph/extract.ts — RawEdge gains:
export interface RawEdge {
  // ...existing fields unchanged...
  /** calls with viaMember: the receiver's resolved type name (from bindings /
   * self / this / Go receiver), when a confident local clue exists. */
  recvType?: string;
}
```

**extract.ts integration (exact changes):**
1. `extractFile`: after `parseSource`, call `const bindings = collectBindings(root, lang)`; add `bindings` and `enclosingClass: string | null` to `WalkCtx` (enclosingClass set to `desc.name` when descending into a `kind === "class"` definition, and for Go methods set from the existing `goReceiverType(node)` result when descending into a `method_declaration`; inherited through `childCtx` otherwise).
2. `calleeName` gains receiver extraction — return type becomes `{ name: string; viaMember: boolean; receiver?: string }`:
   - py `attribute`: object field — `identifier` → its text; `identifier self/cls` handled by caller; `attribute(self, x)` (i.e. object is `attribute` whose own object is `self`) → `"self.x"`; anything else → no receiver.
   - ts/tsx `member_expression`: object `identifier` → text; `this` → `"this"`; `member_expression(this, prop)` → `"this.prop"`; else none.
   - go `selector_expression`: operand `identifier` → text; else none.
3. In `walk`'s call branch, compute `recvType`:
   ```ts
   let recvType: string | undefined;
   const r = callee.receiver;
   if (r === "self" || r === "cls" || r === "this") recvType = ctx.enclosingClass ?? undefined;
   else if (r?.startsWith("self.") || r?.startsWith("this.")) {
     // class-scope attr binding: normalize both prefixes to how bindings stored them
     recvType = ctx.bindings.lookup(ctx.scope, r) ?? ctx.bindings.lookup(ctx.scope, r.replace(/^this\./, "self.")) ?? undefined;
   } else if (r) {
     // Go: an identifier receiver that IS the method's receiver var binds to the receiver type
     recvType = (ctx.lang === "go" && r === ctx.goReceiverVar ? ctx.enclosingClass : undefined)
       ?? ctx.bindings.lookup(ctx.scope, r) ?? undefined;
   }
   if (recvType) edges.push({ ...callEdge, recvType }); else edges.push(callEdge);
   ```
   (`goReceiverVar`: capture the receiver parameter's variable name alongside `goReceiverType` when describing a Go method — extend `describeGo`/`WalkCtx` accordingly. Store `self.attr` bindings with the `self.` prefix only; the lookup normalizes `this.` → `self.` so one storage convention serves py and ts.)
4. `collectBindings` walk maintains its own scope stack using the SAME definition-recognition rules — to avoid duplicating `describe()`, export a tiny helper from extract.ts: `export function defName(node: Parser.SyntaxNode, lang: Language): string | null` returning the name for def-node types (class/function/method/type_spec/variable_declarator-with-function — reuse the existing describe logic's name reads; refactor `describe` to call it). bindings.ts imports `defName` (no cycle: extract imports bindings for `collectBindings`, bindings imports only the type + `defName` — put `defName` in bindings.ts instead if that creates a cycle: bindings.ts must NOT import extract.ts values, only `import type`. Decision: implement `defName` inside bindings.ts, duplicating only the small name-field reads (`childForFieldName("name")`, TS variable_declarator, Go type_spec) with a comment pointing at describe(); ~25 lines, acceptable duplication to keep imports acyclic.)

- [ ] **Step 1: failing tests** (`test/graph-bindings.test.ts`) — parse snippets with the real grammars via `extractFile` and assert on the returned `rawEdges` (this tests collection + capture end-to-end):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

function callEdges(src: string, lang: "python" | "typescript" | "go", file = `x.${lang === "python" ? "py" : lang === "go" ? "go" : "ts"}`) {
  return extractFile(file, src, lang).rawEdges.filter((e) => e.relation === "calls");
}

test("py: constructor assignment binds receiver type", () => {
  const edges = callEdges("class A:\n    def m(self): pass\napp = A()\ndef f():\n    app.m()\n", "python");
  const call = edges.find((e) => e.name === "m" && e.viaMember);
  assert.equal(call?.recvType, "A");
});

test("py: parameter annotation binds", () => {
  const edges = callEdges("def f(app: FastAPI):\n    app.include_router()\n", "python");
  assert.equal(edges.find((e) => e.name === "include_router")?.recvType, "FastAPI");
});

test("py: self binds to enclosing class; self.attr via __init__ assignment", () => {
  const src = "class S:\n    def __init__(self):\n        self.q = Queue()\n    def go(self):\n        self.helper()\n        self.q.put(1)\n";
  const edges = callEdges(src, "python");
  assert.equal(edges.find((e) => e.name === "helper")?.recvType, "S");
  assert.equal(edges.find((e) => e.name === "put")?.recvType, "Queue");
});

test("py: import alias resolves to original name", () => {
  const edges = callEdges("from fastapi import FastAPI as F\napp = F()\napp.get()\n", "python");
  assert.equal(edges.find((e) => e.name === "get")?.recvType, "FastAPI");
});

test("py: unknown receiver leaves recvType unset (chained call)", () => {
  const edges = callEdges("def f():\n    factory().run()\n", "python");
  assert.equal(edges.find((e) => e.name === "run")?.recvType, undefined);
});

test("ts: new-expression + type annotation + this", () => {
  const src = "class S {\n  q: Queue = new Queue();\n  go() { this.helper(); this.q.put(1); }\n  helper() {}\n}\nconst app = new FastAPI();\nfunction f(r: Router) { app.mount(); r.use(); }\n";
  const edges = callEdges(src, "typescript");
  assert.equal(edges.find((e) => e.name === "helper")?.recvType, "S");
  assert.equal(edges.find((e) => e.name === "put")?.recvType, "Queue");
  assert.equal(edges.find((e) => e.name === "mount")?.recvType, "FastAPI");
  assert.equal(edges.find((e) => e.name === "use")?.recvType, "Router");
});

test("go: composite literal, var decl, NewX convention, receiver var", () => {
  const src = "package m\nfunc f() {\n  u := User{}\n  var d *DB\n  s := NewServer()\n  u.Save()\n  d.Query()\n  s.Start()\n}\nfunc (w *Worker) run() { w.stop() }\n";
  const edges = callEdges(src, "go", "x.go");
  assert.equal(edges.find((e) => e.name === "Save")?.recvType, "User");
  assert.equal(edges.find((e) => e.name === "Query")?.recvType, "DB");
  assert.equal(edges.find((e) => e.name === "Start")?.recvType, "Server");
  assert.equal(edges.find((e) => e.name === "stop")?.recvType, "Worker");
});

test("scope shadowing: inner binding wins", () => {
  const src = "app = A()\ndef f():\n    app = B()\n    app.m()\n";
  const edges = callEdges(src, "python");
  assert.equal(edges.find((e) => e.name === "m")?.recvType, "B");
});
```

- [ ] **Step 2: run** `node --import tsx --test test/graph-bindings.test.ts` → all FAIL (`recvType` undefined everywhere / collectBindings not found).
- [ ] **Step 3: implement** bindings.ts + the extract.ts integration exactly as specified above.
- [ ] **Step 4: bindings tests + FULL suite green** (existing extract tests in test/graph-go.test.ts etc. must pass unchanged — recvType is additive).
- [ ] **Step 5: Commit** — `feat(graph): receiver-type binding pass — member calls carry their receiver's type`

---

### Task 3: Typed member-call resolution in `resolve.ts` + fastapi acceptance

**Files:**
- Modify: `src/graph/resolve.ts`
- Test: create `test/graph-resolve-typed.test.ts` (resolveEdges is pure — fixtures are plain arrays)

**Interfaces:**
- Consumes: `RawEdge.recvType` (Task 2), existing `resolveEdges(nodes, rawEdges, opts)`.
- Produces: no signature change; behavior addition only.

**Resolution algorithm (replaces the `calls` branch when `e.viaMember && e.recvType`):**
1. Build once per resolveEdges call: `ownerMethod: Map<string, NodeV1[]>` keyed `` `${ownerName}.${methodName}` `` where for every `kind === "method"` node, `ownerName` is the second-to-last dot-segment of the id's post-`#` part (`a.py#Class.method` → `Class`; `f.go#Recv.m` → `Recv`; a method id with no dot-qualifier is skipped). Also `classParents: Map<string, string[]>` from raw `extends` edges: source id's last post-`#` segment → [e.name] (accumulate).
2. Try the ownership chain `[recvType, ...ancestors]` where ancestors come from following `classParents` breadth-first, max depth 3, cycle-guarded:
   - candidates = `ownerMethod.get(`${type}.${e.name}`)` — if exactly one → add edge (confidence: `extracted` if `candidate.path === e.file`, else `inferred`); if a same-file candidate exists among several → that one, `extracted`; if several and none same-file → **drop and stop** (do not continue up the chain past an ambiguous owner level); if zero → continue to the next ancestor.
3. Chain exhausted with no candidate → fall back to the existing untyped path (unique bare-name method), unchanged.
4. `e.viaMember && !e.recvType` → existing behavior, untouched.

- [ ] **Step 1: failing tests** (`test/graph-resolve-typed.test.ts`):

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEdges } from "../src/graph/resolve.js";
import type { NodeV1 } from "../src/graph/types.js";

function n(id: string, kind: NodeV1["kind"]): NodeV1 {
  const name = id.includes("#") ? id.split("#")[1].split(".").pop()! : id;
  return { id, name, kind, path: id.split("#")[0], span: "L1-L1", signature: null,
    exported: true, origin: "ast", body_hash: "h", summary_state: "pending", summary: null, crux: null } as NodeV1;
}

const NODES = [
  n("app.py", "file"), n("app.py#FastAPI", "class"), n("app.py#FastAPI.include_router", "method"),
  n("routing.py", "file"), n("routing.py#APIRouter", "class"), n("routing.py#APIRouter.include_router", "method"),
  n("t.py", "file"), n("t.py#test_x", "function"),
];

test("typed member call resolves despite global name ambiguity", () => {
  const edges = resolveEdges(NODES, [
    { source: "t.py#test_x", relation: "calls", name: "include_router", viaMember: true, recvType: "FastAPI", file: "t.py" },
  ]);
  const call = edges.find((e) => e.relation === "calls");
  assert.equal(call?.target, "app.py#FastAPI.include_router");
  assert.equal(call?.confidence, "inferred");
});

test("untyped ambiguous member call still drops (regression guard)", () => {
  const edges = resolveEdges(NODES, [
    { source: "t.py#test_x", relation: "calls", name: "include_router", viaMember: true, file: "t.py" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("extends chain: method inherited from parent resolves", () => {
  const nodes = [...NODES, n("sub.py", "file"), n("sub.py#MyApp", "class"), n("u.py", "file"), n("u.py#use", "function")];
  const edges = resolveEdges(nodes, [
    { source: "sub.py#MyApp", relation: "extends", name: "FastAPI", file: "sub.py" },
    { source: "u.py#use", relation: "calls", name: "include_router", viaMember: true, recvType: "MyApp", file: "u.py" },
  ]);
  const call = edges.find((e) => e.relation === "calls");
  assert.equal(call?.target, "app.py#FastAPI.include_router");
});

test("ambiguous owner level drops instead of guessing", () => {
  const nodes = [...NODES, n("v2.py", "file"), n("v2.py#FastAPI", "class"), n("v2.py#FastAPI.include_router", "method")];
  const edges = resolveEdges(nodes, [
    { source: "t.py#test_x", relation: "calls", name: "include_router", viaMember: true, recvType: "FastAPI", file: "t.py" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("same-file owner wins among duplicates, confidence extracted", () => {
  const nodes = [...NODES, n("t.py#FastAPI", "class"), n("t.py#FastAPI.include_router", "method")];
  const edges = resolveEdges(nodes, [
    { source: "t.py#test_x", relation: "calls", name: "include_router", viaMember: true, recvType: "FastAPI", file: "t.py" },
  ]);
  const call = edges.find((e) => e.relation === "calls");
  assert.equal(call?.target, "t.py#FastAPI.include_router");
  assert.equal(call?.confidence, "extracted");
});

test("unknown recvType falls back to unique bare-name path", () => {
  const nodes = [n("a.py", "file"), n("a.py#Only", "class"), n("a.py#Only.solo", "method"), n("b.py", "file"), n("b.py#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "b.py#f", relation: "calls", name: "solo", viaMember: true, recvType: "Ghost", file: "b.py" },
  ]);
  assert.equal(edges.find((e) => e.relation === "calls")?.target, "a.py#Only.solo");
});
```

- [ ] **Step 2: run** → FAIL (typed calls currently dropped/ignored). **Step 3: implement** per the algorithm. **Step 4: typed tests + FULL suite green.**
- [ ] **Step 5: Acceptance on fastapi (the 1→37 check).** `git clone --depth 1 https://github.com/fastapi/fastapi /private/tmp/claude-501/-Users-shrishdwivedi-Documents-Context-graphs/d3b217f7-4a78-4399-b91a-8bb7db720797/scratchpad/fastapi-accept` (reuse if present), `npm run build`, then `node dist/cli.js build <that dir>` and `node dist/cli.js callers include_router <that dir>`. Record the caller count in the task report. **Gate: ≥ 25 distinct callers** (reference tool found 37; we accept ≥25 given our stricter drop rules). Also run `node dist/cli.js callers include_router` on a pre-Task-2 build (git stash or the 0.4.5 dist) to record the before number (expected: 1). Sanity: `node dist/cli.js impact solve_dependencies -d 2 <dir>` still returns the Task-time results (no regression), and total edge count grows < 2× (print both counts).
- [ ] **Step 6: Commit** — `feat(graph): typed member-call resolution — receiver bindings resolve ambiguous methods`

---

### Task 4: `graft grep` — search grouped by enclosing symbol (CLI + MCP)

**Files:**
- Create: `src/graph/relations.ts` (shared WALK_RELATIONS — traverse.ts:32 and graphrank.ts:25 both import it; delete their local copies)
- Create: `src/search/grep.ts` (pure core), `src/search/grep-cli.ts` (formatter + CLI runner)
- Modify: `src/cli.ts` (command), `src/mcp/tools.ts` (tool `graft_grep`)
- Test: create `test/search-grep.test.ts`; extend `test/mcp-tools.test.ts` (tool list + one round-trip)

**Interfaces (produced):**
```ts
// src/graph/relations.ts
import type { Relation } from "./types.js";
/** Relations that carry dependency meaning for traversal/ranking (contains excluded). */
export const WALK_RELATIONS: ReadonlySet<Relation> = new Set(["calls", "references", "imports", "implements", "extends"]);
```
```ts
// src/search/grep.ts
export interface GrepHit { line: number; text: string }           // text trimmed, ≤160 chars
export interface GrepGroup {
  symbol: { id: string; name: string; kind: string; path: string; span: string } | null; // null → file-level (outside any symbol)
  path: string;
  inDegree: number;                                                // incoming WALK_RELATIONS edges to the symbol (0 for file-level)
  hits: GrepHit[];
}
export interface GrepResult {
  pattern: string; filesSearched: number; totalHits: number;
  groups: GrepGroup[];                                             // sorted: inDegree desc, then path asc
  truncated: { files: number; hits: number };                      // dropped counts — never silent
}
export function grepGraph(
  graph: GraphV1, repoRoot: string, pattern: string,
  opts?: { ignoreCase?: boolean; fixed?: boolean; in?: string; maxHits?: number /* default 300 */ },
): GrepResult;
```
Core behavior: iterate the graph's `kind === "file"` nodes (filtered by `opts.in` path-substring); read each file from `repoRoot` (skip unreadable — count into `truncated.files`); regex per line (`fixed` → escape); for each hit find the innermost enclosing symbol: per file, pre-sort that file's symbol nodes by span start; innermost = the containing span with the greatest start line (spans parse via the existing `/^L(\d+)-L(\d+)$/`). Group hits per symbol (or per file when uncovered); attach in-degree computed once per call (single pass over `graph.edges` filtered by WALK_RELATIONS, counting by target id). Stop collecting at `maxHits` and record the remainder in `truncated.hits`.

CLI: `graft grep <pattern> [dir]` with `-i, --ignore-case`, `--fixed`, `--in <path>`, `--json`, honoring global `--dir`. Human output (grep-cli.ts):
```
"include_router" — 41 hits in 9 symbols across 6 files (searched 1213 indexed files)

FastAPI.include_router · method · fastapi/applications.py:L1108-L1122 · 12 in-edges
  L1110: def include_router(self, router: APIRouter, *, prefix: str = "",
tests/test_router.py (module level) · 0 in-edges
  L14: app.include_router(router)
```
Zero hits → exit 0, stderr: `no hits for "<pattern>" in 1213 indexed files — unindexed files (docs, configs, new files) aren't searched; try grep -rn "<pattern>" for those`. Zero indexed files (no graph) → exit 1, `✗ no graph — run graft build first`.
MCP tool `graft_grep`: `{ pattern: string, in?: string, ignore_case?: boolean, fixed?: boolean }`, root+dirOverride from the server factory (Task 1), returns the human rendering (like existing tools), truncation note included.

- [ ] **Step 1: failing tests** (`test/search-grep.test.ts`) — build a small fixture repo on disk (the builtRepo helper pattern from test/mcp-tools.test.ts): two TS files where `parse` appears (a) inside a heavily-called function, (b) inside a rarely-called one, (c) at module level. Assert: group order by inDegree; innermost-symbol attribution (a hit inside a method of a class maps to the method, not the class); `in` filter; `fixed` escaping (`a.b` doesn't match `axb`); maxHits truncation surfaces in `truncated.hits`; zero-hit result shape. Plus one WALK_RELATIONS import equivalence test: traverse and graphrank behave identically after the refactor (existing suites cover this — just run them).
- [ ] **Step 2: verify fail. Step 3: implement (relations.ts refactor first — full suite must stay green after just that refactor — then grep core, CLI, MCP).**
- [ ] **Step 4: full suite green** (mcp-tools list assertion updated: 6 tools at this point).
- [ ] **Step 5: Commit** — `feat(search): graft grep — matches grouped by enclosing symbol, ranked by coupling`

---

### Task 5: `graft map` — compact repo orientation (CLI + MCP)

**Files:**
- Create: `src/graph/map.ts`
- Modify: `src/cli.ts`, `src/mcp/tools.ts` (tool `graft_map`)
- Test: create `test/graph-map.test.ts`; extend `test/mcp-tools.test.ts` (7-tool list + round-trip)

**Interfaces (produced):**
```ts
// src/graph/map.ts
export interface Hub { name: string; kind: string; path: string; span: string; inDegree: number }
export interface DirEntry { path: string; files: number; symbols: number; languages: string[]; hubs: Hub[] }
export interface RepoMap {
  totals: { files: number; symbols: number; edges: number; languages: string[] };
  dirs: DirEntry[];               // sorted by symbol count desc, capped, remainder noted
  hotspots: Hub[];                // global top by inDegree
  dropped: number;                // dirs beyond the cap
}
export function buildRepoMap(graph: GraphV1, opts?: { maxDirs?: number /* 16 */, hubsPerDir?: number /* 3 */, hotspots?: number /* 12 */ }): RepoMap;
export function formatRepoMap(map: RepoMap): string;   // deterministic, target ≤ 6000 chars
```
Grouping: by first path segment; if one segment holds > 60% of all file nodes, split THAT segment one level deeper (single refinement pass — e.g. everything under `src/` becomes `src/ask`, `src/graph`, …). Languages via `languageOf` on file paths. Hubs/hotspots by in-degree over `WALK_RELATIONS` (import from Task 4's relations.ts), ties broken by name asc for determinism. Human rendering:
```
repo map — 1213 files · 6707 symbols · 10912 edges · python

fastapi/            312 files · 2841 symbols   hubs: APIRouter (routing.py, 84←), FastAPI (applications.py, 61←), Depends (param_functions.py, 57←)
tests/              761 files · 3312 symbols   hubs: ...

hotspots: APIRouter · class · fastapi/routing.py:L562-L1470 · 84←   ...
```
No graph → exit 1 with the standard `run graft build first` line. CLI: `graft map [dir] [--json]`, honors global `--dir`. MCP `graft_map`: `{}` input, returns the rendering.

- [ ] **Step 1: failing tests** (`test/graph-map.test.ts`) — pure fixtures (hand-built GraphV1, nodeStub pattern from test/graphrank.test.ts): totals correct; >60% dir splits one level; hub ordering by inDegree with deterministic ties; formatRepoMap under 6000 chars on a 60-node fixture and contains the hub names; dropped-dirs note appears when maxDirs exceeded.
- [ ] **Step 2-4: verify fail → implement → full suite green (mcp tool list now exactly: graft_ask, graft_check, graft_blast_radius, graft_callers, graft_callees, graft_grep, graft_map).**
- [ ] **Step 5: Commit** — `feat(graph): graft map — token-budgeted repo orientation from the wiring graph`

---

### Task 6: Guidance, README, and end-to-end acceptance

**Files:**
- Modify: `src/claude/skill-template.ts` — in the task-shape guidance: the sweep bullet now routes to `graft grep "<literal>"` (grouped by symbol, exhaustive over indexed files, notes what it can't see) with raw `grep -rn` as the fallback for unindexed files; add a first-contact bullet: `graft map` before exploring an unfamiliar repo. Keep the existing validated phrasing style — additive edits, don't rewrite the file.
- Modify: `src/hosts/instructions.ts` — same two additions in `instructionBody()`, condensed.
- Modify: `README.md` — command table rows for `grep`/`map`; extend the graph-commands section with one example each (reuse the exact human-output blocks from Tasks 4–5); one line under the callers/impact docs noting method calls resolve through receiver types (constructors/annotations) so qualified coupling queries work on method-heavy code.
- Tests: extend `test/claude-skill-template.test.ts` + `test/hosts-instructions.test.ts` — assert the new phrases (`graft grep`, `graft map`) appear; existing phrase assertions must keep passing (additive).

- [ ] **Step 1: failing tests** (phrase assertions), **Step 2: verify fail**, **Step 3: implement template/instruction/README edits**, **Step 4: full suite + `npm run build`.**
- [ ] **Step 5: End-to-end acceptance sweep** (record all numbers in the task report):
  1. fastapi (from Task 3's checkout): `node dist/cli.js callers include_router` ≥ 25 callers; `node dist/cli.js grep "regex: Annotated" --in param_functions` groups = exactly the 7 param functions (Path/Query/Header/Cookie/Body/Form/File); `node dist/cli.js map` renders < 6000 chars and names APIRouter or FastAPI among hotspots.
  2. Own repo: `node dist/cli.js init . --no-build && node dist/cli.js build . && node dist/cli.js grep "WALK_RELATIONS"` attributes hits to relations.ts + importers; `graft map` sane.
  3. MCP: one stdio session listing 7 tools; `graft_grep` + `graft_map` round-trip.
- [ ] **Step 6: Commit** — `docs(guidance): sweeps via graft grep, orientation via graft map`

## Out of scope

- Chained-call receivers (`factory().run()`), cross-file function-return inference, generics/unions — the treadmill we're deliberately not on. Unknown receivers keep drop-don't-guess.
- Ranking hygiene (test/generated de-ranking) — separate 0.5.0 item.
- Release/publish — separate step after review.

## Self-Review

- Spec coverage: #1 → Tasks 2–3 (all four supported languages, tsx via TS shapes); #2 → Task 4; #4 → Task 5; bug found in testing → Task 1; guidance so agents actually use the new surface → Task 6. ✓
- No placeholders: every step carries code, exact node types verified against the vendored grammars (dumped 2026-07-22), exact commands. ✓
- Type consistency: `RawEdge.recvType` (Tasks 2→3), `WALK_RELATIONS` from relations.ts (Tasks 4→5), `GrepResult`/`RepoMap` shapes used in CLI/MCP/tests match their definitions. ✓
- Philosophy guard: regression tests pin untyped behavior (Task 3 test 2) and ambiguous-owner drops (test 4). ✓
