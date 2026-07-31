/**
 * Tests for C# extraction in the Tier-1 code graph. Builds a small C# project in a
 * temp dir and asserts the emitted nodes (classes, structs, interfaces, records,
 * enums, delegates, methods) and edges (calls, heritage) match the AST walk in
 * extract.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const WIDGET_CS = `using System;

namespace MyApp.Services
{
    public interface IFoo
    {
        void Bar();
    }

    public class Base
    {
        protected void Helper() {}
    }

    public class Widget : Base, IFoo
    {
        private readonly IFoo _foo;

        public Widget(IFoo foo)
        {
            _foo = foo;
        }

        public void Bar()
        {
            _foo.Bar();
            this.Helper();
            Local();
        }

        private void Local() {}

        void IFoo.Bar() {}
    }

    public struct Point
    {
        public int X;
    }

    public interface IReader
    {
        int Read();
    }

    public enum Color { Red, Green }

    public record PointR(int X, int Y);

    public delegate void Handler(object sender);
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-csharp-"));
  writeFileSync(join(dir, "Widget.cs"), WIDGET_CS);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("C# extraction: classes, structs, interfaces, records, enums, delegates", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir); // $0, Tier-1 only
    assert.ok(result.languages.includes("csharp"), "languages should include csharp");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    assert.equal(nodeById(graph!, "Widget.cs#IFoo")?.kind, "interface");
    assert.equal(nodeById(graph!, "Widget.cs#Base")?.kind, "class");
    assert.equal(nodeById(graph!, "Widget.cs#Widget")?.kind, "class");
    assert.equal(nodeById(graph!, "Widget.cs#Point")?.kind, "struct");
    assert.equal(nodeById(graph!, "Widget.cs#IReader")?.kind, "interface");
    assert.equal(nodeById(graph!, "Widget.cs#Color")?.kind, "enum");
    assert.equal(nodeById(graph!, "Widget.cs#PointR")?.kind, "class");
    assert.equal(nodeById(graph!, "Widget.cs#Handler")?.kind, "type");

    // methods — exported by explicit `public` modifier
    const ctor = nodeById(graph!, "Widget.cs#Widget.Widget");
    assert.equal(ctor?.kind, "method");
    assert.equal(ctor?.exported, true);
    const bar = nodeById(graph!, "Widget.cs#Widget.Bar");
    assert.equal(bar?.kind, "method");
    assert.equal(bar?.exported, true);
    const local = nodeById(graph!, "Widget.cs#Widget.Local");
    assert.equal(local?.exported, false);

    // explicit interface implementation gets a distinct, interface-qualified id
    // from the public `Bar()` of the same name in the same class
    const explicitBar = nodeById(graph!, "Widget.cs#Widget.IFoo.Bar");
    assert.equal(explicitBar?.kind, "method");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("C# extraction: heritage and call edges", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // class heritage: base class and interface both land as "extends"
    // (base_list doesn't syntactically distinguish the two)
    const extendsBase = graph.edges.find(
      (e) => e.relation === "extends" && e.source === "Widget.cs#Widget" && e.target === "Widget.cs#Base",
    );
    assert.ok(extendsBase, "Widget should extend Base");
    const extendsIFoo = graph.edges.find(
      (e) => e.relation === "extends" && e.source === "Widget.cs#Widget" && e.target === "Widget.cs#IFoo",
    );
    assert.ok(extendsIFoo, "Widget should extend/implement IFoo");

    // bare-identifier field receiver: `_foo.Bar()` resolves via the field's bound type
    const fieldCall = graph.edges.find(
      (e) => e.relation === "calls" && e.source === "Widget.cs#Widget.Bar" && e.target === "Widget.cs#IFoo.Bar",
    );
    assert.ok(fieldCall, "_foo.Bar() should resolve to IFoo.Bar via the field's bound type");

    // `this.Helper()` resolves to the base class's method through the extends chain
    const thisCall = graph.edges.find(
      (e) => e.relation === "calls" && e.source === "Widget.cs#Widget.Bar" && e.target === "Widget.cs#Base.Helper",
    );
    assert.ok(thisCall, "this.Helper() should resolve to Base.Helper");

    // bare same-file call
    const bareCall = graph.edges.find(
      (e) => e.relation === "calls" && e.source === "Widget.cs#Widget.Bar" && e.target === "Widget.cs#Widget.Local",
    );
    assert.ok(bareCall, "Local() should resolve to Widget.Local");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
