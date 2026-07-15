/**
 * Tests for the viz graph assembly: .context/*.md frontmatter → {meta, nodes, edges}
 * with relation normalization, dangling-edge dropping, and malformed-file skipping.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleContextGraph, normalizeRelation } from "../src/viz/assemble.js";

function makeContextDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "graftviz-"));
  writeFileSync(
    join(dir, "alpha.md"),
    `---
name: Alpha
slug: alpha
type: system
sources:
  - path: src/a.ts
    hash: abc123
links:
  - to: beta
    relation: influences
    description: Affects beta somehow.
  - to: gamma
    relation: uses
---
<!-- context:generated:start -->
## Summary
Alpha coordinates the whole show.

## Related
- uses [[beta]]
<!-- context:generated:end -->
## Notes
_preserved_
`,
  );
  writeFileSync(
    join(dir, "beta.md"),
    `---
name: Beta
slug: beta
type: concept
sources: []
links: []
---
<!-- context:generated:start -->
## Summary
Beta holds shared state.
<!-- context:generated:end -->
`,
  );
  // Invalid YAML frontmatter — must be skipped, not fatal.
  writeFileSync(join(dir, "broken.md"), `---\nname: [unclosed\n---\nbody\n`);
  writeFileSync(join(dir, "manifest.json"), "{}\n");
  return dir;
}

test("assembleContextGraph builds nodes and edges from frontmatter", () => {
  const dir = makeContextDir();
  try {
    const g = assembleContextGraph(dir);

    assert.equal(g.nodes.length, 2);
    assert.deepEqual(g.nodes.map((n) => n.id).sort(), ["alpha", "beta"]);

    const alpha = g.nodes.find((n) => n.id === "alpha")!;
    assert.equal(alpha.name, "Alpha");
    assert.equal(alpha.type, "system");
    assert.deepEqual(alpha.sources, ["src/a.ts"]);
    assert.equal(alpha.summary, "Alpha coordinates the whole show.");

    // influences → configures; dangling gamma edge dropped
    assert.equal(g.edges.length, 1);
    assert.deepEqual(g.edges[0], {
      source: "alpha",
      target: "beta",
      relation: "configures",
      description: "Affects beta somehow.",
    });

    assert.equal(g.meta.nodeCount, 2);
    assert.equal(g.meta.edgeCount, 1);
    assert.equal(g.meta.droppedEdges, 1);
    assert.equal(g.meta.skippedFiles, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalizeRelation maps vague verbs to the closed vocabulary", () => {
  assert.equal(normalizeRelation("influences"), "configures");
  assert.equal(normalizeRelation("supports"), "validates");
  assert.equal(normalizeRelation("defines"), "validates");
  assert.equal(normalizeRelation("measures"), "validates");
  // members of the vocabulary pass through untouched
  for (const rel of ["part_of", "uses", "depends_on", "produces", "configures", "validates", "implements"]) {
    assert.equal(normalizeRelation(rel), rel);
  }
  // unknown verbs are kept verbatim (viewer renders them as their own chip)
  assert.equal(normalizeRelation("orchestrates"), "orchestrates");
});
