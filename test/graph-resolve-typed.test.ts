import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRepoMap } from "../src/graph/map.js";
import { resolveEdges } from "../src/graph/resolve.js";
import { extractFile } from "../src/graph/extract.js";
import type { RawEdge } from "../src/graph/extract.js";
import type { NodeV1 } from "../src/graph/types.js";

// `owner` mirrors what extractFile now stamps on a method node: the bare name of
// its immediate enclosing class (the segment just before its own name in the
// dotted id) — set here so these hand-built fixtures match real extraction output.
function n(id: string, kind: NodeV1["kind"]): NodeV1 {
  const post = id.includes("#") ? id.split("#")[1] : id;
  const segs = post.split(".");
  const name = segs[segs.length - 1];
  const owner = kind === "method" && segs.length >= 2 ? segs[segs.length - 2] : undefined;
  return { id, name, kind, owner, path: id.split("#")[0], span: "L1-L1", signature: null,
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

test("unknown receiver type does not guess from a unique bare method name", () => {
  const nodes = [n("a.py", "file"), n("a.py#Only", "class"), n("a.py#Only.solo", "method"), n("b.py", "file"), n("b.py#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "b.py#f", relation: "calls", name: "solo", viaMember: true, recvType: "Ghost", file: "b.py" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("untyped member call does not guess from a unique bare method name", () => {
  const nodes = [n("a.py", "file"), n("a.py#Only", "class"), n("a.py#Only.solo", "method"), n("b.py", "file"), n("b.py#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "b.py#f", relation: "calls", name: "solo", viaMember: true, file: "b.py" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("builtin-container receiver drops instead of bare-name fallback", () => {
  const nodes = [n("b.py", "file"), n("b.py#FileBindings", "class"), n("b.py#FileBindings.set", "method"), n("c.py", "file"), n("c.py#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "c.py#f", relation: "calls", name: "set", viaMember: true, recvType: "dict", file: "c.py" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("builtin-container receiver (TS Map) drops instead of bare-name fallback", () => {
  const nodes = [n("b.ts", "file"), n("b.ts#FileBindings", "class"), n("b.ts#FileBindings.set", "method"), n("c.ts", "file"), n("c.ts#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "c.ts#f", relation: "calls", name: "set", viaMember: true, recvType: "Map", file: "c.ts" },
  ]);
  assert.equal(edges.filter((e) => e.relation === "calls").length, 0);
});

test("Go NewServer()→Server recall still resolves (regression guard, non-builtin recvType)", () => {
  const nodes = [n("srv.go", "file"), n("srv.go#Server", "class"), n("srv.go#Server.Start", "method"), n("m.go", "file"), n("m.go#f", "function")];
  const edges = resolveEdges(nodes, [
    { source: "m.go#f", relation: "calls", name: "Start", viaMember: true, recvType: "Server", file: "m.go" },
  ]);
  assert.equal(edges.find((e) => e.relation === "calls")?.target, "srv.go#Server.Start");
});

test("unresolved member calls cannot inflate map hubs and hotspots (#35)", () => {
  const nodes = [
    n("bindings.ts", "file"),
    n("bindings.ts#FileBindings", "class"),
    n("bindings.ts#FileBindings.set", "method"),
    n("consumer.ts", "file"),
    n("consumer.ts#write", "function"),
    n("real.ts", "file"),
    n("real.ts#writeBinding", "function"),
  ];
  const edges = resolveEdges(nodes, [
    { source: "consumer.ts#write", relation: "calls", name: "set", viaMember: true, file: "consumer.ts" },
    { source: "consumer.ts#write", relation: "calls", name: "set", viaMember: true, recvType: "Map", file: "consumer.ts" },
    { source: "real.ts#writeBinding", relation: "calls", name: "set", viaMember: true, recvType: "FileBindings", file: "real.ts" },
  ]);

  const map = buildRepoMap({
    meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: ["typescript"] },
    nodes,
    edges,
  });
  const set = map.hotspots.find((h) => h.name === "set");
  assert.equal(set?.inDegree, 1, "only the owner-qualified FileBindings.set call contributes");
});

/**
 * `classParents` used to be keyed by the declaring class's BARE NAME, which fuses the
 * hierarchies of two same-named classes in different packages: `a/Base` extending `Foo`
 * and `b/Base` extending `Bar` became `Base → [Foo, Bar]`. A `base.handle()` in package
 * a then climbed into package b's `Bar.handle` and shipped it as an `inferred` call
 * edge. `Base`, `Client`, `Config`, `Handler` repeated across modules is ordinary, and
 * crossing between them silently is exactly the guess the rest of resolve.ts refuses.
 */
test("homonymous classes in different packages do not share an inheritance chain", () => {
  const nodes = [
    n("a/Base.java", "file"), n("a/Base.java#Base", "class"),
    n("a/Foo.java", "file"), n("a/Foo.java#Foo", "class"), n("a/Foo.java#Foo.handle", "method"),
    n("b/Base.java", "file"), n("b/Base.java#Base", "class"),
    n("b/Bar.java", "file"), n("b/Bar.java#Bar", "class"), n("b/Bar.java#Bar.handle", "method"),
    n("a/Use.java", "file"), n("a/Use.java#use", "method"),
  ];
  const raw: RawEdge[] = [
    { source: "a/Base.java#Base", relation: "extends", name: "Foo", file: "a/Base.java" },
    { source: "b/Base.java#Base", relation: "extends", name: "Bar", file: "b/Base.java" },
    // The call site is in package a, but `Base` is ambiguous across the repo, so there
    // is no honest answer about whose hierarchy to climb.
    { source: "a/Use.java#use", relation: "calls", name: "handle", viaMember: true, recvType: "Base", file: "a/Use.java" },
  ];
  const calls = resolveEdges(nodes, raw).filter((e) => e.relation === "calls");
  assert.deepEqual(calls, [], "an ambiguous receiver type must stop the climb, not pick a package");
});

test("an unambiguous inherited method still resolves through a same-file superclass", () => {
  // The guard above must not cost recall: when the receiver type resolves to exactly
  // one class, its own `extends` chain is walked exactly as before.
  const nodes = [
    n("a/Base.java", "file"), n("a/Base.java#Base", "class"),
    n("a/Foo.java", "file"), n("a/Foo.java#Foo", "class"), n("a/Foo.java#Foo.handle", "method"),
    n("a/Use.java", "file"), n("a/Use.java#use", "method"),
  ];
  const raw: RawEdge[] = [
    { source: "a/Base.java#Base", relation: "extends", name: "Foo", file: "a/Base.java" },
    { source: "a/Use.java#use", relation: "calls", name: "handle", viaMember: true, recvType: "Base", file: "a/Use.java" },
  ];
  const call = resolveEdges(nodes, raw).find((e) => e.relation === "calls");
  assert.equal(call?.target, "a/Foo.java#Foo.handle");
});

test("a homonym beside the CALLER cannot hijack an inherited method", () => {
  // `pkg/Widget` extends `Base`; the call site lives in another package that declares
  // its own unrelated `Base`. Climbing to the "same file as the caller" candidate would
  // hand back `other`'s `draw` for a receiver that has nothing to do with it. Two
  // `Base`s and no way to tell which one `Widget` meant is a drop, not a coin toss.
  const nodes = [
    n("pkg/Widget.java", "file"), n("pkg/Widget.java#Widget", "class"),
    n("pkg/Base.java", "file"), n("pkg/Base.java#Base", "class"), n("pkg/Base.java#Base.draw", "method"),
    n("other/Use.java", "file"), n("other/Use.java#Base", "class"), n("other/Use.java#Base.draw", "method"),
    n("other/Use.java#use", "method"),
  ];
  const raw: RawEdge[] = [
    { source: "pkg/Widget.java#Widget", relation: "extends", name: "Base", file: "pkg/Widget.java" },
    { source: "other/Use.java#use", relation: "calls", name: "draw", viaMember: true, recvType: "Widget", file: "other/Use.java" },
  ];
  const calls = resolveEdges(nodes, raw).filter((e) => e.relation === "calls");
  assert.deepEqual(calls.map((e) => e.target), [], "the caller's own Base is not evidence about Widget's");
});

// A2: resolve.ts used to derive ownerMethod/classParents keys by slicing `n.id`,
// which breaks once ids can carry a dedup ordinal (A3). extract.ts now stamps a
// `owner` field at mint time instead; these tests pin the field's contract and
// prove the owner-keyed lookups it feeds still resolve exactly as the old
// slicing did.

test("A2: extractFile sets NodeV1.owner to the immediate enclosing class/receiver on method nodes only", () => {
  const tsNodes = extractFile("a.ts", "class Cache {\n  get(): void {}\n}\n", "typescript").nodes;
  assert.equal(tsNodes.find((x) => x.id === "a.ts#Cache.get")?.owner, "Cache");
  assert.equal(tsNodes.find((x) => x.id === "a.ts#Cache")?.owner, undefined, "a class node itself carries no owner");

  const pyNodes = extractFile(
    "b.py",
    "class Outer:\n    def render(self):\n        pass\n\n\nclass Container:\n    class Inner:\n        def render(self):\n            pass\n",
    "python",
  ).nodes;
  assert.equal(pyNodes.find((x) => x.id === "b.py#Outer.render")?.owner, "Outer");
  assert.equal(
    pyNodes.find((x) => x.id === "b.py#Container.Inner.render")?.owner,
    "Inner",
    "nested class: owner is the immediate parent, not the outer container",
  );

  const goNodes = extractFile("c.go", "package c\n\ntype Server struct{}\n\nfunc (s *Server) Start() {}\n", "go").nodes;
  assert.equal(goNodes.find((x) => x.id === "c.go#Server.Start")?.owner, "Server");
});

test("A2: owner-keyed ownerMethod/classParents resolve identically to the old id-slicing scheme (mixed fixture: sibling classes + inheritance)", () => {
  const src = [
    "class Base {",
    "  render(): void {}",
    "}",
    "class Widget extends Base {",
    "  render(): void {}",
    "}",
    "class Other {",
    "  render(): void {}",
    "}",
    "class Sub extends Other {}",
    "function use(): void {}",
    "",
  ].join("\n");
  const { nodes, rawEdges } = extractFile("mixed.ts", src, "typescript");

  const callWidget: RawEdge = { source: "mixed.ts#use", relation: "calls", name: "render", viaMember: true, recvType: "Widget", file: "mixed.ts" };
  const callSub: RawEdge = { source: "mixed.ts#use", relation: "calls", name: "render", viaMember: true, recvType: "Sub", file: "mixed.ts" };
  const edges = resolveEdges(nodes, [...rawEdges, callWidget, callSub]);

  const targets = edges
    .filter((e) => e.relation === "calls" && e.source === "mixed.ts#use")
    .map((e) => e.target)
    .sort();
  assert.deepEqual(
    targets,
    ["mixed.ts#Other.render", "mixed.ts#Widget.render"],
    "Widget's own render must win over Base's/Other's (owner-scoped), and Sub inherits Other's via classParents",
  );
});
