/**
 * Drift guard between the THREE places the graph vocabulary is written down:
 * the `Kind`/`Relation`/`Confidence` unions in src/graph/types.ts, the sets in
 * src/graph/invariants.ts, and the standalone copies in scripts/graph-quality.mjs.
 *
 * The duplication in the .mjs is deliberate (invariants.ts says so: the CLI report
 * has to work against a stale or missing dist/), but nothing checked the copies
 * still agreed. Adding one member to `Kind` — the union has grown twice already,
 * once for Go's `struct` and once for the generic tier's module/constant/variable —
 * made the script report `bad kind` on every real graph and exit 1 under --strict,
 * i.e. a green change turning the CI gate red for a graph that is perfectly valid.
 *
 * The unions are read out of the source text because types do not exist at
 * runtime; invariants.ts is compared by behaviour rather than by export, so the
 * check keeps working whether or not it ever exposes its sets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KINDS, RELATIONS, CONFIDENCE, analyze } from "../scripts/graph-quality.mjs";
import { checkGraphInvariants } from "../src/graph/invariants.js";
import type { Confidence, GraphV1, Kind, NodeV1, Relation } from "../src/graph/types.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const typesSrc = readFileSync(join(repoRoot, "src", "graph", "types.ts"), "utf8");

/** The string literals of `export type <name> = "a" | "b" | …;`, comments and all. */
function unionMembers(name: string): string[] {
  const start = typesSrc.indexOf(`export type ${name} =`);
  assert.notEqual(start, -1, `no 'export type ${name}' in src/graph/types.ts`);
  const body = typesSrc.slice(start, typesSrc.indexOf(";", start));
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
}

function node(kind: string, id: string): NodeV1 {
  return {
    path: "a.ts", id, name: id, kind: kind as Kind, span: "L1-L2",
    signature: null, exported: true, origin: "ast", body_hash: "h",
    summary_state: "pending", summary: null, crux: null,
  } as NodeV1;
}

function graph(nodes: NodeV1[], edges: GraphV1["edges"] = []): GraphV1 {
  return { meta: { version: 1, nodeCount: nodes.length, edgeCount: edges.length, languages: [] }, nodes, edges };
}

test("graph-quality's KINDS matches the Kind union in types.ts", () => {
  assert.deepEqual([...KINDS].sort(), unionMembers("Kind"));
});

test("graph-quality's RELATIONS and CONFIDENCE match their unions in types.ts", () => {
  assert.deepEqual([...RELATIONS].sort(), unionMembers("Relation"));
  assert.deepEqual([...CONFIDENCE].sort(), unionMembers("Confidence"));
});

test("graph-quality and invariants.ts accept exactly the same vocabulary", () => {
  // Behavioural equality: every kind the script allows must also pass the shared
  // checker, and a kind neither knows must fail in both.
  const nodes = [...KINDS].map((k, i) => node(String(k), `n${i}`));
  assert.deepEqual(checkGraphInvariants(graph(nodes)).problems, []);
  assert.deepEqual(analyze(graph(nodes), "x").invariants.sample, []);

  const bogus = graph([node("macro", "n0")]);
  assert.match(checkGraphInvariants(bogus).problems.join("\n"), /bad kind 'macro'/);
  assert.match(analyze(bogus, "x").invariants.sample.join("\n"), /bad kind 'macro'/);
});

test("both copies agree on relations and confidences", () => {
  const nodes = [node("function", "a"), node("function", "b")];
  for (const relation of RELATIONS as Set<Relation>) {
    for (const confidence of CONFIDENCE as Set<Confidence>) {
      const g = graph(nodes, [{ source: "a", target: "b", relation, confidence }]);
      assert.deepEqual(checkGraphInvariants(g).problems, [], `${relation}/${confidence}`);
      assert.equal(analyze(g, "x").invariants.ok, true, `${relation}/${confidence}`);
    }
  }
  const bad = graph(nodes, [{ source: "a", target: "b", relation: "shadows" as Relation, confidence: "guessed" as Confidence }]);
  assert.equal(checkGraphInvariants(bad).problems.length, 2);
  assert.equal(analyze(bad, "x").invariants.violations, 2);
});

test("importing the script does not run its CLI", () => {
  // The module used to read process.argv and `process.exit(2)` at import time —
  // importing it from a test would have killed the runner outright.
  assert.equal(typeof analyze, "function");
});
