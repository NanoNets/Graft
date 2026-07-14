/**
 * Serialize a {@link GraphV1} to `<contextDir>/graph.json`.
 *
 * Output is sorted (nodes by id, edges by source/relation/target) and carries no
 * timestamps, so rebuilding an unchanged repo produces a byte-identical file and
 * git diffs stay minimal.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EdgeV1, GraphV1 } from "./types.js";

export const GRAPH_FILE = "graph.json";

/**
 * Read an existing graph.json for use as the Tier-2 cache. Returns null when the
 * file is absent or unparseable (a fresh build, or a corrupt file we'll replace).
 */
export function readGraph(path: string): GraphV1 | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as GraphV1;
  } catch {
    return null;
  }
}

export function writeGraph(graph: GraphV1, outDir: string): string {
  const sorted: GraphV1 = {
    ...graph,
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...graph.edges].sort(edgeOrder),
  };
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, GRAPH_FILE);
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
  return path;
}

function edgeOrder(a: EdgeV1, b: EdgeV1): number {
  return (
    a.source.localeCompare(b.source) ||
    a.relation.localeCompare(b.relation) ||
    a.target.localeCompare(b.target)
  );
}
