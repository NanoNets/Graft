/**
 * The diagram's caps, which are the part that lies if it gets them wrong.
 *
 * The first version of `mermaidDiagram` capped the changed-file boxes in diff order
 * and then drew only the arrows whose source box happened to survive. On graft's own
 * 23-file PR that left five of six modules with no arrow at all, so the picture said
 * "nothing depends on any of this" — the exact opposite of the report underneath it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownReport, mermaidDiagram } from "../src/blast/render.js";
import type { BlastReport, ImpactedModule } from "../src/blast/blast.js";

function mod(label: string, from: string[], symbols: number): ImpactedModule {
  return {
    label,
    files: [`${label}dep.ts`],
    from,
    symbols: Array.from({ length: symbols }, (_, i) => ({
      id: `${label}dep.ts#s${i}`, name: `s${i}`, kind: "function",
      path: `${label}dep.ts`, span: "L1-L3", relation: "calls", depth: 1,
    })),
  };
}

/** 12 changed files where only the last two reach anything — the cap must keep those. */
function report(): BlastReport {
  const changed = Array.from({ length: 12 }, (_, i) => ({
    path: `src/f${i}.ts`,
    status: "modified" as const,
    ranges: [{ start: 1, end: 1 }],
  }));
  return {
    basis: "origin/main...HEAD",
    depth: 2,
    changed,
    unindexed: [],
    deleted: [],
    seeds: [],
    impacted: [],
    modules: [mod("core/", ["src/f10.ts", "src/f11.ts"], 3), mod("api/", ["src/f11.ts"], 1)],
  };
}

test("blast diagram: the files that reach something survive the box cap", () => {
  const diagram = mermaidDiagram(report()) ?? assert.fail("expected a diagram");

  assert.match(diagram, /C\d+\["src\/f10\.ts"\]/, "a reaching file must be drawn");
  assert.match(diagram, /C\d+\["src\/f11\.ts"\]/, "a reaching file must be drawn");
  // Three attributions across two modules, every one of them drawn.
  const arrows = diagram.split("\n").filter((l) => l.includes(" --> "));
  assert.equal(arrows.length, 3, `expected every arrow drawn, got:\n${arrows.join("\n")}`);
  assert.ok(!diagram.includes("arrow(s) from changed files not drawn"), "no arrow should be dropped here");
});

test("blast diagram: nodes and links carry explicit colours, so either GitHub theme is legible", () => {
  const diagram = mermaidDiagram(report()) ?? assert.fail("expected a diagram");

  assert.match(diagram, /classDef changedNode fill:#[0-9A-F]{6},stroke:#[0-9A-F]{6},stroke-width:1px,color:#[0-9A-F]{6};/i);
  assert.match(diagram, /classDef moduleNode fill:#[0-9A-F]{6}/i);
  assert.match(diagram, /^\s+linkStyle 0,1,2 stroke:#/m);
});

test("blast markdown: a truncated diagram says what it left out", () => {
  const body = markdownReport(report());

  assert.match(body, /2 of 12 changed files not drawn/);
  assert.match(body, /Everything is listed below/);
  // Collapsed headers use real tags: GitHub renders no markdown emphasis in <summary>.
  assert.match(body, /<summary><strong>core\/<\/strong> — 3 symbols in 1 file<\/summary>/);
  assert.ok(!body.includes("<summary>**"), "asterisks would render literally");
});
