/**
 * The blast radius as a viewer graph.
 *
 * This is the Context tab of the page a PR comment links to, so the two things that
 * matter are that it carries the SAME names the comment shows — one computation, not
 * two — and that its edges point the way the viewer words them: the affected area
 * depends on the changed one, never the reverse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { blastVizGraph } from "../src/blast/viz.js";
import { repoLabel } from "../src/blast/blast-cli.js";
import type { BlastReport, ChangedArea, ImpactedModule } from "../src/blast/blast.js";

function mod(label: string, from: string[], symbols: number): ImpactedModule {
  return {
    label, labelSource: "named", key: label,
    files: [`${label}dep.ts`],
    from,
    symbols: Array.from({ length: symbols }, (_, i) => ({
      id: `${label}dep.ts#s${i}`, name: `s${i}`, kind: "function",
      path: `${label}dep.ts`, span: `L${i + 1}-L${i + 3}`, relation: "calls", depth: i + 1,
    })),
  };
}

function area(label: string, files: string[]): ChangedArea {
  return {
    label, labelSource: "named", key: label, files, seeds: files.length,
    tests: "none", testFiles: [], changedTestFiles: [],
    reached: 0, behavioural: 2, unreached: ["doThing", "doOther"], seedNames: ["doThing"],
  };
}

function report(): BlastReport {
  return {
    basis: "origin/main...HEAD", depth: 2,
    changed: [{ path: "src/a.ts", status: "modified", ranges: [{ start: 1, end: 1 }] }],
    unindexed: [".github/workflows/x.yml"],
    deleted: [], seeds: [], impacted: [],
    modules: [mod("Query Freshness Gate", ["src/a.ts", "test/a.test.ts"], 2), mod("MCP Tool Surface", ["src/a.ts"], 1)],
    testModules: [mod("Test Suites", ["src/a.ts"], 9)],
    areas: [area("LLM Failure Gate", ["src/a.ts"])],
  };
}

test("blast viz: one node per area, typed so the viewer colours and legends itself", () => {
  const g = blastVizGraph(report());

  assert.deepEqual(
    g.nodes.map((n) => `${n.type}:${n.name}`),
    ["changed:LLM Failure Gate", "affected:Query Freshness Gate", "affected:MCP Tool Surface"],
    "the names are the comment's names — the page is not a second computation",
  );
  // Test-only dependents stay out here too: 9 symbols of "your tests call this"
  // would be the biggest node on the canvas.
  assert.ok(!g.nodes.some((n) => n.name === "Test Suites"), "test-only clusters are not drawn");
  assert.equal(g.meta.nodeCount, 3);
  assert.equal(g.meta.skippedFiles, 1, "changed files no parser claims are carried, not hidden");
});

test("blast viz: edges are the dependency, so the viewer's wording comes out right", () => {
  const g = blastVizGraph(report());

  assert.deepEqual(g.edges.map((e) => `${e.source} -${e.relation}-> ${e.target}`), [
    "affected:Query Freshness Gate -depends_on-> changed:LLM Failure Gate",
    "affected:MCP Tool Surface -depends_on-> changed:LLM Failure Gate",
  ]);
  // `test/a.test.ts` reached the first module but belongs to no area, so it must not
  // produce a dangling edge the viewer would silently drop.
  assert.equal(g.edges.length, 2);
});

test("blast viz: a node carries where to look and whether its tests moved", () => {
  const g = blastVizGraph(report());
  const [changed, affected] = g.nodes;

  assert.match(changed.summary, /Changed in this PR: 1 file, 1 symbol\. no test reaches it\. 0 of 2 changed functions/);
  assert.deepEqual(changed.sources, ["src/a.ts"]);

  assert.match(affected.summary, /2 dependent symbols in 1 file\. Nearest hop: s0 at depth 1 \(calls\)\./);
  // `path · span` is what the detail panel renders as a jump target.
  assert.deepEqual(affected.sources, ["Query Freshness Gatedep.ts · L1-L3", "Query Freshness Gatedep.ts · L2-L4"]);
});

test("blast viz: nothing is capped, unlike the comment's diagram", () => {
  const r = report();
  r.modules = Array.from({ length: 12 }, (_, i) => mod(`Area ${i}`, ["src/a.ts"], 1));

  const g = blastVizGraph(r);

  assert.equal(g.nodes.length, 13, "a pannable canvas has no reason to drop areas");
  assert.equal(g.edges.length, 12);
});

test("blast viz: the page is titled after the repository, not the checkout directory", () => {
  // CI checks a pull request out into a directory named for the job — ours is `pr` —
  // so a published page announced itself as "pr". The remote is the repository.
  const dir = mkdtempSync(join(tmpdir(), "pr"));
  assert.equal(repoLabel(dir), basename(dir), "no remote: the directory name is all there is");

  execFileSync("git", ["-C", dir, "init", "-q"]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", "git@github.com:NanoNets/Graft.git"]);
  assert.equal(repoLabel(dir), "Graft", "an ssh remote names the repo, not the owner or the path");

  execFileSync("git", ["-C", dir, "remote", "set-url", "origin", "https://github.com/NanoNets/Graft"]);
  assert.equal(repoLabel(dir), "Graft", "and an https remote with no .git suffix reads the same");
});
