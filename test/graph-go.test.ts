/**
 * Tests for Go extraction in the Tier-1 code graph. Builds a small Go module in a
 * temp dir and asserts the emitted nodes (funcs, methods, structs, interfaces, type
 * aliases) and edges (calls, intra-module imports) match the AST walk in extract.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_GO = `package main

import (
\t"fmt"
\t"mymod/pkg/util"
)

type ID int

type User struct {
\tName string
}

type Reader interface {
\tRead() error
}

func Foo() {
\tfmt.Println("hi")
\tutil.Helper()
}

func bar() {}

func (u *User) Save() error {
\tFoo()
\tu.name()
\treturn nil
}

func (u User) name() string { return u.Name }
`;

const UTIL_GO = `package util

func Helper() {}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-go-"));
  writeFileSync(join(dir, "go.mod"), "module mymod\n\ngo 1.21\n");
  writeFileSync(join(dir, "main.go"), MAIN_GO);
  mkdirSync(join(dir, "pkg", "util"), { recursive: true });
  writeFileSync(join(dir, "pkg", "util", "util.go"), UTIL_GO);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("Go extraction: funcs, methods, structs, interfaces, type aliases", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir); // $0, Tier-1 only
    assert.ok(result.languages.includes("go"), "languages should include go");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    // functions — exported by leading-uppercase
    const foo = nodeById(graph!, "main.go#Foo");
    assert.equal(foo?.kind, "function");
    assert.equal(foo?.exported, true);
    assert.equal(nodeById(graph!, "main.go#bar")?.exported, false);

    // methods — receiver-qualified name, file-scope, exported by method name
    const save = nodeById(graph!, "main.go#User.Save");
    assert.equal(save?.kind, "method");
    assert.equal(save?.exported, true);
    const name = nodeById(graph!, "main.go#User.name");
    assert.equal(name?.kind, "method");
    assert.equal(name?.exported, false);

    // named types
    assert.equal(nodeById(graph!, "main.go#User")?.kind, "struct");
    assert.equal(nodeById(graph!, "main.go#Reader")?.kind, "interface");
    assert.equal(nodeById(graph!, "main.go#ID")?.kind, "type");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Go extraction: call and import edges", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // same-file plain call resolves: Save() → Foo()
    const call = graph.edges.find(
      (e) => e.relation === "calls" && e.source === "main.go#User.Save" && e.target === "main.go#Foo",
    );
    assert.ok(call, "Save should have a resolved calls edge to Foo");

    // member call `u.name()` resolves to the receiver method by its bare name
    const memberCall = graph.edges.find(
      (e) =>
        e.relation === "calls" && e.source === "main.go#User.Save" && e.target === "main.go#User.name",
    );
    assert.ok(memberCall, "Save should have a resolved calls edge to User.name");

    // intra-module import resolves to the target package's file node
    const internal = graph.edges.find(
      (e) => e.relation === "imports" && e.source === "main.go" && e.target === "pkg/util/util.go",
    );
    assert.ok(internal, "mymod/pkg/util should resolve to pkg/util/util.go");

    // stdlib import stays an unresolved package string
    const external = graph.edges.find(
      (e) => e.relation === "imports" && e.source === "main.go" && e.target === "fmt",
    );
    assert.ok(external, "fmt should remain an external package string");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Go extraction: go.mod in a subdirectory resolves intra-module imports", async () => {
  // Monorepo shape: the module lives under backend/, not the repo root.
  const dir = mkdtempSync(join(tmpdir(), "graft-go-sub-"));
  try {
    mkdirSync(join(dir, "backend", "store"), { recursive: true });
    writeFileSync(join(dir, "backend", "go.mod"), "module example.com/app\n\ngo 1.21\n");
    writeFileSync(
      join(dir, "backend", "main.go"),
      `package main\n\nimport (\n\t"fmt"\n\t"example.com/app/store"\n)\n\nfunc main() {\n\tfmt.Println(store.New())\n}\n`,
    );
    writeFileSync(join(dir, "backend", "store", "store.go"), "package store\n\nfunc New() int { return 0 }\n");

    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // `example.com/app/store` → backend/store (module dir `backend` + subpath `store`)
    const internal = graph.edges.find(
      (e) =>
        e.relation === "imports" &&
        e.source === "backend/main.go" &&
        e.target === "backend/store/store.go",
    );
    assert.ok(internal, "subdir-module import should resolve to backend/store/store.go");

    // stdlib still stays external
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "imports" && e.source === "backend/main.go" && e.target === "fmt",
      ),
      "fmt should remain an external package string",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
