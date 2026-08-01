import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFile } from "../src/graph/extract.js";

function callEdges(src: string, lang: "python" | "typescript" | "go" | "powershell", file = `x.${lang === "python" ? "py" : lang === "go" ? "go" : lang === "powershell" ? "ps1" : "ts"}`) {
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

test("go: binding inside a method body resolves (scope parity with extract)", () => {
  const src = "package m\nfunc (w *Worker) run() {\n  u := User{}\n  u.Save()\n}\n";
  const edges = callEdges(src, "go", "x.go");
  assert.equal(edges.find((e) => e.name === "Save")?.recvType, "User");
});

test("go: local binding shadows package-level var (never the wrong type)", () => {
  const src = "package m\nvar u *Logger\nfunc (w *Worker) run() {\n  u := User{}\n  u.Save()\n}\n";
  const edges = callEdges(src, "go", "x.go");
  assert.equal(edges.find((e) => e.name === "Save")?.recvType, "User");
});

test("ts: aliased type annotation resolves to original name", () => {
  const edges = callEdges("import { Router as R } from './r';\nfunction f(r: R) { r.use(); }\n", "typescript");
  assert.equal(edges.find((e) => e.name === "use")?.recvType, "Router");
});

test("py: aliased annotation resolves to original name", () => {
  const edges = callEdges("from r import APIRouter as AR\ndef f(r: AR):\n    r.get()\n", "python");
  assert.equal(edges.find((e) => e.name === "get")?.recvType, "APIRouter");
});

test("ps: typed assignment binds case-insensitive receiver and static constructor", () => {
  const edges = callEdges("[widget]$w = [WIDGET]::new()\n$w.Render()\n", "powershell");
  assert.equal(edges.find((e) => e.name === "Render")?.recvType, "widget");
  assert.equal(edges.find((e) => e.name === "new")?.recvType, "WIDGET");
});

test("ps: $this binds case-insensitively to the enclosing class", () => {
  const src = "class Widget { [void] Render() { $This.Helper() } [void] Helper() {} }\n";
  const edges = callEdges(src, "powershell");
  assert.equal(edges.find((e) => e.name === "Helper")?.recvType, "Widget");
});

test("ps: New-Object positional and -TypeName forms bind", () => {
  const src = "$a = New-Object Widget\n$b = New-Object -TypeName widget\n$a.Render()\n$b.Render()\n";
  const edges = callEdges(src, "powershell").filter((e) => e.name === "Render");
  assert.deepEqual(edges.map((e) => e.recvType), ["Widget", "widget"]);
});

test("ps: typed script and class-method parameters bind", () => {
  const src = "param([Widget]$outer)\n$outer.Render()\nclass C { [void] Use([Widget]$inner) { $inner.Render() } }\n";
  const edges = callEdges(src, "powershell").filter((e) => e.name === "Render");
  assert.deepEqual(edges.map((e) => e.recvType), ["Widget", "Widget"]);
});

test("ps: typed class properties bind through $this member access", () => {
  const src = "class C { [Widget]$View; [void] Go() { $THIS.View.Render() } }\n";
  const edges = callEdges(src, "powershell");
  assert.equal(edges.find((e) => e.name === "Render")?.recvType, "Widget");
});

test("ps: decorated parameter's type binds despite a preceding attribute", () => {
  const src = "param([Parameter(Mandatory=$true)][Widget]$w)\n$w.Render()\n";
  const edges = callEdges(src, "powershell");
  assert.equal(edges.find((e) => e.name === "Render")?.recvType, "Widget");
});

test("ps: New-Object binds -TypeName by parameter, not position", () => {
  const src = [
    "$a = New-Object -ArgumentList 1 -TypeName Widget",
    "$b = New-Object -ArgumentList Widget",
    "$a.Render()",
    "$b.Render()",
    "",
  ].join("\n");
  const edges = callEdges(src, "powershell").filter((e) => e.name === "Render");
  assert.deepEqual(
    edges.map((e) => e.recvType),
    ["Widget", undefined],
    "-ArgumentList's own value must never be mistaken for the type, whichever side of -TypeName it falls on",
  );
});

test("ps: a scope-qualified function keeps binding lookups in lockstep with extract's scope stack (Z1)", () => {
  const src = "function global:Setup {\n  [Widget]$w = [Widget]::new()\n  $w.Render()\n}\n";
  const edges = callEdges(src, "powershell");
  assert.equal(
    edges.find((e) => e.name === "Render")?.recvType,
    "Widget",
    "bindings.ts's defName must strip the same global: qualifier extract.ts's describePowerShell does, or the " +
      "scope key the binding was stored under ('global:Setup') never matches the lookup key ('Setup')",
  );
});

test("ps: New-Object binds the sole positional type past a valueless switch", () => {
  const src = [
    "$a = New-Object -Verbose Widget",
    "$b = New-Object -TypeName Widget -Verbose",
    "$a.Render()",
    "$b.Render()",
    "",
  ].join("\n");
  const edges = callEdges(src, "powershell").filter((e) => e.name === "Render");
  assert.deepEqual(
    edges.map((e) => e.recvType),
    ["Widget", "Widget"],
    "-Verbose takes no value, so it must not swallow the one positional type argument that follows it",
  );
});
