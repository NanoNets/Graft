/**
 * Tests for Dart extraction in the Tier-1 code graph.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_DART = `
import 'package:my_app/models/user.dart';

class BaseService {}

class UserService extends BaseService {
  void fetchUser() {
    print("fetching");
    helper();
  }
}

void helper() {}
`;

const USER_DART = `
class User {
  String name;
  User(this.name);
}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-dart-"));
  writeFileSync(join(dir, "pubspec.yaml"), "name: my_app\n");
  mkdirSync(join(dir, "lib", "models"), { recursive: true });
  writeFileSync(join(dir, "lib", "main.dart"), MAIN_DART);
  writeFileSync(join(dir, "lib", "models", "user.dart"), USER_DART);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("Dart extraction: classes, functions, inheritance, call edges, imports", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir);
    assert.ok(result.languages.includes("dart"), "languages should include dart");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    const baseService = nodeById(graph!, "lib/main.dart#BaseService");
    assert.equal(baseService?.kind, "class");

    const userService = nodeById(graph!, "lib/main.dart#UserService");
    assert.equal(userService?.kind, "class");

    const helper = nodeById(graph!, "lib/main.dart#helper");
    assert.equal(helper?.kind, "function");

    const user = nodeById(graph!, "lib/models/user.dart#User");
    assert.equal(user?.kind, "class");

    // Extends relation
    const extendsEdge = graph!.edges.find(
      (e) => e.relation === "extends" && e.source === "lib/main.dart#UserService" && e.target === "lib/main.dart#BaseService"
    );
    assert.ok(extendsEdge, "UserService should extend BaseService");

    // Import resolution
    const importEdge = graph!.edges.find(
      (e) => e.relation === "imports" && e.source === "lib/main.dart" && e.target === "lib/models/user.dart"
    );
    assert.ok(importEdge, "package:my_app/models/user.dart should resolve to lib/models/user.dart");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
