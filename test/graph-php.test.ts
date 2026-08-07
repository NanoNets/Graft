/**
 * Tests for PHP extraction in the Tier-1 code graph. Builds a small PHP project in
 * a temp dir and asserts the emitted nodes (classes, methods, interface, trait,
 * enum, top-level function) and edges (calls, extends, implements) match the AST
 * walk in extract.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const APP_PHP = `<?php
namespace App;

use App\\Support\\Base;

class Widget extends Base implements Runnable
{
    use Loggable;

    public function run(): int
    {
        return $this->helper();
    }

    private function helper(): int
    {
        return Base::seed();
    }

    public function act(Base $b): string
    {
        return $b->label();
    }
}

interface Runnable {}

trait Loggable {}

enum Color: string
{
    case Red = 'r';
}

function topLevel(): int
{
    return 1;
}

$make = fn(): int => topLevel();

register(function (): void {
    topLevel();
});
`;

const BASE_PHP = `<?php
namespace App\\Support;

class Base
{
    public static function seed(): int
    {
        return 0;
    }

    public function label(): string
    {
        return 'b';
    }
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-php-"));
  writeFileSync(join(dir, "composer.json"), `{"name": "acme/app"}\n`);
  writeFileSync(join(dir, "app.php"), APP_PHP);
  writeFileSync(join(dir, "base.php"), BASE_PHP);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("PHP extraction: classes, methods, interface, trait, enum, function", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir); // $0, Tier-1 only
    assert.ok(result.languages.includes("php"), "languages should include php");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    assert.equal(nodeById(graph!, "app.php#Widget")?.kind, "class");
    assert.equal(nodeById(graph!, "base.php#Base")?.kind, "class");

    // methods — file-scoped under their class; visibility drives `exported`
    const run = nodeById(graph!, "app.php#Widget.run");
    assert.equal(run?.kind, "method");
    assert.equal(run?.exported, true, "public method is exported");
    assert.equal(nodeById(graph!, "app.php#Widget.helper")?.exported, false, "private method is not exported");

    // language-specific kinds
    assert.equal(nodeById(graph!, "app.php#Runnable")?.kind, "interface");
    assert.equal(nodeById(graph!, "app.php#Loggable")?.kind, "trait");
    assert.equal(nodeById(graph!, "app.php#Color")?.kind, "enum");
    assert.equal(nodeById(graph!, "app.php#topLevel")?.kind, "function");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PHP extraction: call, extends, and implements edges", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // `class Widget extends Base` resolves cross-file by class name
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "extends" && e.source === "app.php#Widget" && e.target === "base.php#Base",
      ),
      "Widget should have a resolved extends edge to Base",
    );

    // `implements Runnable` resolves to the same-file interface
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "implements" && e.source === "app.php#Widget" && e.target === "app.php#Runnable",
      ),
      "Widget should have a resolved implements edge to Runnable",
    );

    // `$this->helper()` resolves to the receiver method (self → enclosing class)
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "app.php#Widget.run" && e.target === "app.php#Widget.helper",
      ),
      "run should have a resolved calls edge to helper",
    );

    // `Base::seed()` static call resolves to the target class method by name
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "app.php#Widget.helper" && e.target === "base.php#Base.seed",
      ),
      "helper should have a resolved calls edge to Base.seed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PHP extraction: trait use and typed-parameter receiver binding", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // `use Loggable;` inside the class body resolves to the trait (modelled as implements)
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "implements" && e.source === "app.php#Widget" && e.target === "app.php#Loggable",
      ),
      "Widget should have a resolved trait-use (implements) edge to Loggable",
    );

    // `act(Base $b)` -> `$b->label()` resolves via the typed-parameter binding
    // ($b : Base), not by bare method name — Base.label is the only match anyway,
    // but the binding is what makes this correct when several classes share a name.
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "app.php#Widget.act" && e.target === "base.php#Base.label",
      ),
      "act should resolve $b->label() to Base.label through the parameter binding",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PHP extraction: closures become nodes and own the calls inside them", async () => {
  const dir = makeFixture();
  try {
    await buildGraph(dir);
    const graph = readGraph(wiringPath(join(dir, "graft")))!;

    // an assigned arrow-fn is named after its variable (like a TS arrow-const)
    assert.equal(nodeById(graph, "app.php#make")?.kind, "function", "assigned closure `$make` is a function node");

    // a bare callback (`register(function () {…})`) is an anonymous `{closure}` node
    assert.ok(
      graph.nodes.some((n) => n.id === "app.php#{closure}" && n.kind === "function"),
      "anonymous callback becomes a {closure} function node",
    );

    // the call inside each closure attributes to the closure, not the file —
    // this is what keeps a closure-only routing table structured
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "app.php#make" && e.target === "app.php#topLevel",
      ),
      "the arrow-fn body's call to topLevel is owned by `make`",
    );
    assert.ok(
      graph.edges.some(
        (e) => e.relation === "calls" && e.source === "app.php#{closure}" && e.target === "app.php#topLevel",
      ),
      "the anonymous callback's call to topLevel is owned by {closure}",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
