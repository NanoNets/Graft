/**
 * Serialize a {@link GraphV1} to `<contextDir>/.graph/wiring.json`.
 *
 * The wiring graph lives in a hidden `.graph/` subdir because it is machine-only:
 * the agent never greps or reads it — it reaches the wiring data through the
 * per-file markdown cards (grep) and the `ask` tool (edge traversal). Output is
 * sorted (nodes by id, edges by source/relation/target) and carries no
 * timestamps, so rebuilding an unchanged repo produces a byte-identical file and
 * git diffs stay minimal.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EdgeV1, GraphV1, NodeV1 } from "./types.js";

/** Hidden subdir under the context dir that holds machine-only graph artifacts. */
export const GRAPH_DIR = ".graph";
export const GRAPH_FILE = "wiring.json";

/** Absolute path to the wiring graph for a context dir: `<dir>/.graph/wiring.json`. */
export function wiringPath(outDir: string): string {
  return join(outDir, GRAPH_DIR, GRAPH_FILE);
}

/**
 * Read an existing wiring graph for use as the Tier-2 cache. Returns null when the
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
    nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(stripBodyText),
    edges: [...graph.edges].sort(edgeOrder),
  };
  const path = wiringPath(outDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(sorted, null, 2) + "\n");
  return path;
}

/**
 * Drop `body_text` from the SERIALIZED copy of a node — it is ~65% of
 * wiring.json's bytes on a large graph, and every byte of it is already
 * duplicated in the `ask` sidecar (`.cache/ask-index.json`), tokenized, which
 * is the only place anything reads it from. Callers must pass this the
 * in-memory graph BEFORE this stripped copy is produced (see `build.ts`:
 * `writeAskIndex` runs on the original `graph` object, never on a re-read of
 * this slimmed file) — this function never mutates the input node.
 */
function stripBodyText(node: NodeV1): NodeV1 {
  if (node.body_text === undefined) return node;
  const { body_text: _body_text, ...rest } = node;
  return rest as NodeV1;
}

function edgeOrder(a: EdgeV1, b: EdgeV1): number {
  return (
    a.source.localeCompare(b.source) ||
    a.relation.localeCompare(b.relation) ||
    a.target.localeCompare(b.target)
  );
}
