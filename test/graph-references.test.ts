/**
 * Regression coverage for issue #34: imported functions used as values must
 * remain visible to `callers`, but as weaker `references` edges rather than
 * being mislabeled as direct calls.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { callersOf } from "../src/graph/traverse.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { tmpRepo } from "./helpers.js";

test("callers includes an imported function passed as a value (#34)", async () => {
  const root = tmpRepo("graft-references-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "gate.ts"),
    ["export function isActive(): boolean {", "  return true;", "}", ""].join("\n"),
  );
  writeFileSync(
    join(root, "src", "direct.ts"),
    [
      'import { isActive } from "./gate.js";',
      "export function callsItDirectly(): boolean {",
      "  return isActive();",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(root, "src", "consumer.ts"),
    [
      'import { isActive } from "./gate.js";',
      "interface Opts { _isActive?: typeof isActive }",
      "export function run(opts: Opts = {}): boolean {",
      "  const check = opts._isActive ?? isActive;",
      "  return check();",
      "}",
      "",
    ].join("\n"),
  );

  await buildGraph(root, { reuse: false });
  const graph = readGraph(wiringPath(join(root, "graft")))!;
  const target = graph.nodes.find((node) => node.id === "src/gate.ts#isActive");
  assert.ok(target, "fixture target was not indexed");

  const hits = callersOf(graph, target);
  assert.deepEqual(
    hits.map(({ id, relation }) => ({ id, relation })).sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: "src/consumer.ts#Opts", relation: "references" },
      { id: "src/direct.ts#callsItDirectly", relation: "calls" },
      { id: "src/consumer.ts#run", relation: "references" },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
});

test("aliased named imports resolve references to the exported symbol", async () => {
  const root = tmpRepo("graft-reference-alias-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "gate.ts"), "export function isActive(): boolean { return true; }\n");
  writeFileSync(
    join(root, "src", "consumer.ts"),
    [
      'import { isActive as defaultCheck } from "./gate.js";',
      "export function choose(): typeof defaultCheck {",
      "  return defaultCheck;",
      "}",
      "",
    ].join("\n"),
  );

  await buildGraph(root, { reuse: false });
  const graph = readGraph(wiringPath(join(root, "graft")))!;
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.source === "src/consumer.ts#choose" &&
        edge.target === "src/gate.ts#isActive" &&
        edge.relation === "references",
    ),
  );
});

test("a local binding that shadows an import does not create a false reference", async () => {
  const root = tmpRepo("graft-reference-shadow-");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "gate.ts"), "export function isActive(): boolean { return true; }\n");
  writeFileSync(
    join(root, "src", "consumer.ts"),
    [
      'import { isActive } from "./gate.js";',
      "export function choose(isActive: () => boolean): boolean {",
      "  return isActive();",
      "}",
      "",
    ].join("\n"),
  );

  await buildGraph(root, { reuse: false });
  const graph = readGraph(wiringPath(join(root, "graft")))!;
  assert.equal(
    graph.edges.some(
      (edge) =>
        edge.source === "src/consumer.ts#choose" &&
        edge.target === "src/gate.ts#isActive" &&
        edge.relation === "references",
    ),
    false,
  );
});
