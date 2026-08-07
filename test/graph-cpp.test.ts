/**
 * Tests for C/C++ extraction in the Tier-1 code graph (issue #66).
 *
 * C/C++ is a *definitions-only* tier: nodes for functions, methods, classes,
 * structs and enums — but NO call/reference/import edges. C++ has no import
 * bindings (only #include, namespaces, overloads, templates), so name-only
 * call resolution would fabricate edges between every same-named method in the
 * repo. `contains` edges are structural facts and are still emitted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { extractFile } from "../src/graph/extract.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const ENGINE_H = `#pragma once
namespace game {

struct Vec3 { float x; float y; float z; };

enum class EntityKind { Player, Monster };

class Entity {
public:
  Entity();
  void update(float dt);
  float health() const { return hp; }
private:
  float hp;
};

template <typename T>
class Registry {
public:
  void add(T item) { count++; }
  int count = 0;
};

}

class Physics;

void snapEntityToFloor(game::Entity* e);
`;

const PHYSICS_CPP = `#include "engine.h"

float Physics::step(float dt) {
  return dt * gravity;
}

Entity::~Entity() { }

bool operator==(const Vec3& a, const Vec3& b) { return a.x == b.x; }

void snapEntityToFloor(game::Entity* e) {
}

void tick(float dt) {
  snapEntityToFloor(0);
}
`;

const UTIL_C = `int clamp(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

int* make_buffer(void) { return 0; }
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-cpp-"));
  writeFileSync(join(dir, "engine.h"), ENGINE_H);
  writeFileSync(join(dir, "physics.cpp"), PHYSICS_CPP);
  writeFileSync(join(dir, "util.c"), UTIL_C);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("C/C++ extraction: functions, methods, classes, structs, enums", async () => {
  const dir = makeFixture();
  const result = await buildGraph(dir); // $0, Tier-1 only
  assert.ok(result.languages.includes("c/c++"), `languages should include c/c++, got [${result.languages}]`);

  const graph = readGraph(wiringPath(join(dir, "graft")));
  assert.ok(graph, "wiring graph should be written");

  // header: struct / enum / class, found through the namespace wrapper
  assert.equal(nodeById(graph!, "engine.h#Vec3")?.kind, "struct");
  assert.equal(nodeById(graph!, "engine.h#EntityKind")?.kind, "enum");
  assert.equal(nodeById(graph!, "engine.h#Entity")?.kind, "class");

  // inline method inside a class body — kind method, owner set
  const health = nodeById(graph!, "engine.h#Entity.health");
  assert.equal(health?.kind, "method");
  assert.equal(health?.owner, "Entity");

  // template class + its method, found through the template_declaration wrapper
  assert.equal(nodeById(graph!, "engine.h#Registry")?.kind, "class");
  assert.equal(nodeById(graph!, "engine.h#Registry.add")?.kind, "method");

  // prototypes and forward declarations are NOT definitions
  assert.ok(!graph!.nodes.some((n) => n.name === "update"), "method prototype must not be indexed");
  assert.ok(!nodeById(graph!, "engine.h#Physics"), "forward declaration must not be indexed");
  assert.ok(
    !graph!.nodes.some((n) => n.path === "engine.h" && n.name === "snapEntityToFloor"),
    "function prototype must not be indexed",
  );

  // out-of-class definition `Physics::step` — method, owner from the qualifier
  const step = nodeById(graph!, "physics.cpp#Physics.step");
  assert.equal(step?.kind, "method");
  assert.equal(step?.name, "step");
  assert.equal(step?.owner, "Physics");
  // body_text is stripped from the on-disk graph (it lives in the ask sidecar),
  // so assert it at the extraction layer, where it's populated.
  const extracted = extractFile("physics.cpp", PHYSICS_CPP, "cpp");
  const stepNode = extracted.nodes.find((n) => n.id === "physics.cpp#Physics.step");
  assert.ok(stepNode?.body_text?.includes("gravity"), "definition body is indexed for search");

  // destructor and operator definitions keep their spelled names
  const dtor = nodeById(graph!, "physics.cpp#Entity.~Entity");
  assert.equal(dtor?.kind, "method");
  assert.equal(dtor?.name, "~Entity");
  assert.ok(graph!.nodes.some((n) => n.name === "operator==" && n.kind === "function"));

  // free functions, including C and a pointer-returning declarator
  const snap = nodeById(graph!, "physics.cpp#snapEntityToFloor");
  assert.equal(snap?.kind, "function");
  assert.equal(snap?.exported, true);
  assert.ok(snap?.signature?.includes("snapEntityToFloor"), `signature: ${snap?.signature}`);
  assert.equal(nodeById(graph!, "util.c#clamp")?.kind, "function");
  assert.equal(nodeById(graph!, "util.c#make_buffer")?.kind, "function");

  // definitions-only: `tick` calls `snapEntityToFloor` in the same file, and no
  // calls/references/imports edge may exist — only structural containment.
  assert.ok(nodeById(graph!, "physics.cpp#tick"), "tick should be indexed");
  const nonContains = graph!.edges.filter((e) => e.relation !== "contains");
  assert.deepEqual(nonContains, [], "C/C++ must emit no call/reference/import edges");
  assert.ok(
    graph!.edges.some((e) => e.source === "engine.h#Entity" && e.target === "engine.h#Entity.health"),
    "containment edges are still emitted",
  );
});
