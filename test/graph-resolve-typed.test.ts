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
