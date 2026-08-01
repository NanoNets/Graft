/**
 * Tests for Kotlin extraction in the Tier-1 code graph.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

const MAIN_KT = `
package com.example.app

class BaseManager

class UserManager : BaseManager() {
  fun process() {
    doWork()
  }
}

fun doWork() {}
`;

const BUILD_KTS = `
plugins {
    kotlin("jvm") version "1.9.0"
}

fun configureProject() {}
`;

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-kt-"));
  mkdirSync(join(dir, "src", "main", "kotlin"), { recursive: true });
  writeFileSync(join(dir, "build.gradle.kts"), BUILD_KTS);
  writeFileSync(join(dir, "src", "main", "kotlin", "Main.kt"), MAIN_KT);
  return dir;
}

function nodeById(graph: GraphV1, id: string): NodeV1 | undefined {
  return graph.nodes.find((n) => n.id === id);
}

test("Kotlin extraction: classes, functions, inheritance, .kts script support", async () => {
  const dir = makeFixture();
  try {
    const result = await buildGraph(dir);
    assert.ok(result.languages.includes("kotlin"), "languages should include kotlin");

    const graph = readGraph(wiringPath(join(dir, "graft")));
    assert.ok(graph, "wiring graph should be written");

    const baseManager = nodeById(graph!, "src/main/kotlin/Main.kt#BaseManager");
    assert.equal(baseManager?.kind, "class");

    const userManager = nodeById(graph!, "src/main/kotlin/Main.kt#UserManager");
    assert.equal(userManager?.kind, "class");

    const doWork = nodeById(graph!, "src/main/kotlin/Main.kt#doWork");
    assert.equal(doWork?.kind, "function");

    const configureProject = nodeById(graph!, "build.gradle.kts#configureProject");
    assert.equal(configureProject?.kind, "function");

    // Extends relation
    const extendsEdge = graph!.edges.find(
      (e) => e.relation === "extends" && e.source === "src/main/kotlin/Main.kt#UserManager" && e.target === "src/main/kotlin/Main.kt#BaseManager"
    );
    assert.ok(extendsEdge, "UserManager should extend BaseManager");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
