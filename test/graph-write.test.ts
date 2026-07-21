/**
 * Tests for `writeGraph`'s slim serialization: `body_text` is dead weight in
 * `wiring.json` once the `ask` sidecar (`.cache/ask-index.json`) exists — every
 * byte of it is already duplicated there, tokenized. These tests pin the
 * behavior contract: the field never reaches disk, the in-memory graph object
 * `build.ts` still needs for the sidecar is untouched, and every other field
 * round-trips exactly as before.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildGraph } from "../src/graph/build.js";
import { writeGraph, readGraph, wiringPath } from "../src/graph/write.js";
import { contextDirFor } from "../src/context/node-file.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

function makeNode(overrides: Partial<NodeV1> = {}): NodeV1 {
  return {
    id: "a.ts#f",
    name: "f",
    kind: "function",
    path: "a.ts",
    span: "L1-L3",
    signature: "f(): void",
    exported: true,
    origin: "ast",
    body_hash: "hash",
    summary_state: "pending",
    summary: null,
    crux: null,
    ...overrides,
  };
}

test("writeGraph strips body_text from the serialized node but keeps every other field", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-write-"));
  try {
    const node = makeNode({ body_text: "some searchable definition body" });
    const graph: GraphV1 = {
      meta: { version: 1, nodeCount: 1, edgeCount: 0, languages: ["typescript"] },
      nodes: [node],
      edges: [],
    };
    const path = writeGraph(graph, dir);

    const raw = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(raw.nodes.length, 1);
    assert.ok(!("body_text" in raw.nodes[0]), "serialized node must not carry body_text");
    // Every other field is untouched.
    assert.equal(raw.nodes[0].id, node.id);
    assert.equal(raw.nodes[0].name, node.name);
    assert.equal(raw.nodes[0].signature, node.signature);
    assert.equal(raw.nodes[0].body_hash, node.body_hash);

    const reread = readGraph(path);
    assert.equal(reread!.nodes[0].body_text, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writeGraph does not mutate the in-memory node — build.ts's sidecar pass needs body_text intact", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-write-mutate-"));
  try {
    const node = makeNode({ body_text: "untouched body text" });
    const graph: GraphV1 = {
      meta: { version: 1, nodeCount: 1, edgeCount: 0, languages: ["typescript"] },
      nodes: [node],
      edges: [],
    };
    writeGraph(graph, dir);
    assert.equal(node.body_text, "untouched body text", "original node object must be unchanged");
    assert.equal(graph.nodes[0].body_text, "untouched body text", "graph.nodes must still reference the live object");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a node with no body_text (e.g. a file node) round-trips unchanged", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-write-nobody-"));
  try {
    const node = makeNode({ kind: "file", signature: null });
    const graph: GraphV1 = {
      meta: { version: 1, nodeCount: 1, edgeCount: 0, languages: ["typescript"] },
      nodes: [node],
      edges: [],
    };
    const path = writeGraph(graph, dir);
    const raw = JSON.parse(readFileSync(path, "utf8"));
    assert.ok(!("body_text" in raw.nodes[0]));
    assert.equal(raw.nodes[0].kind, "file");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Contract line 1: new builds' wiring.json has NO body_text key on any node ──

test("buildGraph: the serialized wiring.json has no body_text key on ANY node", async () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-write-build-"));
  try {
    writeFileSync(
      join(dir, "auth.ts"),
      `/** Validate an incoming API request's auth token. */\n` +
        `export function validateAuthToken(token: string): boolean {\n` +
        `  return token.length > 0;\n` +
        `}\n\n` +
        `export const FEATURE_FLAG = true;\n`,
    );
    const result = await buildGraph(dir);
    assert.ok(result.nodes > 0, "sanity: the fixture actually produced nodes");

    const outDir = contextDirFor(dir);
    const raw = readFileSync(wiringPath(outDir), "utf8");
    assert.ok(!raw.includes("body_text"), "raw wiring.json text must not contain the body_text key at all");

    const parsed = JSON.parse(raw) as GraphV1;
    assert.ok(parsed.nodes.length > 0);
    for (const n of parsed.nodes) {
      assert.ok(!("body_text" in n), `node ${n.id} must not carry body_text in the serialized graph`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
