/**
 * W2 — mint-time unique node ids.
 *
 * extract.ts used to mint a node's id purely from its scope + own name, so two
 * definitions that happen to share a name (a branch-guarded redeclaration, a
 * duplicated class, PowerShell's habit of letting later `function Foo` defs
 * silently shadow earlier ones, ...) collided onto the SAME id — the second
 * definition's node silently overwrote the first's in every id-keyed lookup.
 *
 * `walk()` now mints ids against a per-file `minted` Set: the first occurrence
 * keeps its bare id, and every later document-order duplicate gets the next
 * free `~2`, `~3`, ... suffix — collision-proof even against a literal source
 * name that already contains `~N` (see the adversarial PowerShell case below),
 * because it keeps incrementing until it finds a truly free id rather than
 * trusting one guessed candidate.
 *
 * These tests assert the ACTUAL minted ids (not a guessed shape) — the hard
 * invariants are: every id unique, the first occurrence keeps the bare id, and
 * ordinals follow document order.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

function assertUniqueIds(nodes: { id: string }[], label: string): void {
  const ids = nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: every node id must be unique, got ${JSON.stringify(ids)}`);
}

test("W2 ts: branch-guarded duplicate function + duplicate class w/ method mint distinct, unique ids", () => {
  const src = `
if (true) {
  function f() { return 1; }
} else {
  function f() { return 2; }
}

class C {
  m(): void {}
}
class C {
  m(): void {}
}
`;
  const { nodes } = extractFile("mix.ts", src, "typescript");
  assertUniqueIds(nodes, "ts dup fn/class");

  const ids = nodes.map((n) => n.id);
  // Document order: first `f` bare, second gets ~2; same for the two `C` classes.
  assert.deepEqual(
    ids,
    ["mix.ts", "mix.ts#f", "mix.ts#f~2", "mix.ts#C", "mix.ts#C.m", "mix.ts#C~2", "mix.ts#C.m~2"],
  );
});

test("W2 py: duplicate def + duplicate class/method mint distinct, unique ids", () => {
  const src = `
def f():
    return 1

def f():
    return 2

class C:
    def m(self):
        pass

class C:
    def m(self):
        pass
`;
  const { nodes } = extractFile("dup.py", src, "python");
  assertUniqueIds(nodes, "py dup def/class");

  const ids = nodes.map((n) => n.id);
  assert.deepEqual(
    ids,
    ["dup.py", "dup.py#f", "dup.py#f~2", "dup.py#C", "dup.py#C.m", "dup.py#C~2", "dup.py#C.m~2"],
  );
});

test("W2 go: two same-name methods on one receiver mint distinct, unique ids", () => {
  const src = `package pkg

type Worker struct{}

func (w *Worker) Run() {}
func (w *Worker) Run() {}
`;
  const { nodes } = extractFile("dup.go", src, "go");
  assertUniqueIds(nodes, "go dup receiver method");

  const ids = nodes.map((n) => n.id);
  assert.deepEqual(ids, ["dup.go", "dup.go#Worker", "dup.go#Worker.Run", "dup.go#Worker.Run~2"]);
});

test("W2 ps1: Pester-style triple duplicate `function Stop-Function` mints three unique ids in document order", () => {
  const src = `function Stop-Function { }
function Stop-Function { }
function Stop-Function { }
`;
  const { nodes } = extractFile("dup.ps1", src, "powershell");
  assertUniqueIds(nodes, "ps1 triple dup function");

  const ids = nodes.map((n) => n.id);
  assert.deepEqual(ids, ["dup.ps1", "dup.ps1#Stop-Function", "dup.ps1#Stop-Function~2", "dup.ps1#Stop-Function~3"]);
});

test("W2 ps1: duplicate class + ctor overloads (Widget.Widget x2) all mint unique ids, resolved via the same loop across the duplicate parents", () => {
  const src = `class Widget {
  Widget() {}
  Widget([string]$name) {}
}

class Widget {
  Widget() {}
}
`;
  const { nodes } = extractFile("dup2.ps1", src, "powershell");
  assertUniqueIds(nodes, "ps1 dup class + ctor overloads");

  const ids = nodes.map((n) => n.id);
  // First Widget class + its two ctor overloads (Widget.Widget, Widget.Widget~2);
  // the SECOND (duplicate) Widget class becomes Widget~2, but its child scope still
  // receives the bare "Widget" idPart, so its own ctor collides with BOTH prior
  // Widget.Widget mints and lands on Widget.Widget~3 — proving the loop resolves
  // collisions across duplicate parents, not just duplicate siblings.
  assert.deepEqual(ids, [
    "dup2.ps1",
    "dup2.ps1#Widget",
    "dup2.ps1#Widget.Widget",
    "dup2.ps1#Widget.Widget~2",
    "dup2.ps1#Widget~2",
    "dup2.ps1#Widget.Widget~3",
  ]);
});

test("W2 ps1 adversarial: a literal `function Get-Thing~2` keeps its own name-derived id untouched; the real duplicate is pushed to ~3", () => {
  const src = `function Get-Thing { }
function Get-Thing~2 { }
function Get-Thing { }
`;
  const { nodes } = extractFile("adv.ps1", src, "powershell");
  assertUniqueIds(nodes, "ps1 adversarial literal ~2");

  const ids = nodes.map((n) => n.id);
  assert.deepEqual(ids, ["adv.ps1", "adv.ps1#Get-Thing", "adv.ps1#Get-Thing~2", "adv.ps1#Get-Thing~3"]);

  // Span-verified: the literal `Get-Thing~2` (line 2) really is the one holding
  // that id — not the third (duplicate) `Get-Thing` definition (line 3), which a
  // naive single-guess `~2` scheme could have collided onto it instead.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  assert.equal(byId.get("adv.ps1#Get-Thing")?.span, "L1-L1");
  assert.equal(byId.get("adv.ps1#Get-Thing~2")?.span, "L2-L2", "the literal Get-Thing~2 definition, untouched");
  assert.equal(byId.get("adv.ps1#Get-Thing~3")?.span, "L3-L3", "the real duplicate, pushed past the literal's id");
});
