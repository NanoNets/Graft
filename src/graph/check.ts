/**
 * `checkGraph` — is the committed `graph.json` still in sync with the code?
 *
 * Deterministic and fast (tree-sitter only, no LLM, no network): it re-runs
 * Tier-1 extraction and diffs the fresh node set against the committed graph by
 * `id` and `body_hash`. Meant for CI — exit non-zero when a PR changed code but
 * didn't rebuild the graph.
 *
 * Drift categories:
 *   added    a definition exists in code but not in graph.json (run `graph`)
 *   removed  a node in graph.json no longer exists in code       (run `graph`)
 *   changed  a node's body_hash differs from the committed one   (run `graph`)
 *   stale    a committed node's summary is flagged stale — its body changed
 *            since it was last summarized                         (run `graph --llm`)
 *
 * `added`/`removed`/`changed` are structural: the graph no longer describes the
 * code. `stale` is a meaning-layer signal the last build already recorded.
 * `pending` (never summarized) is not drift — it's a deliberate Tier-1-only build.
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { contextDirFor } from "../context/node-file.js";
import { extractFile, languageOf } from "./extract.js";
import { listSourceFiles } from "./build.js";
import { GRAPH_FILE, readGraph } from "./write.js";

export interface GraphCheckResult {
  ok: boolean;
  /** True when there is no graph.json (a graph has never been built). */
  missing: boolean;
  added: string[];
  removed: string[];
  changed: string[];
  stale: string[];
  /** Nodes never summarized (reported for context; not counted as drift). */
  pending: number;
}

export interface GraphCheckOptions {
  contextDir?: string;
}

export function checkGraph(dir: string, opts: GraphCheckOptions = {}): GraphCheckResult {
  const root = resolve(dir);
  const outDir = contextDirFor(root, opts.contextDir);

  const result: GraphCheckResult = {
    ok: false,
    missing: false,
    added: [],
    removed: [],
    changed: [],
    stale: [],
    pending: 0,
  };

  const committed = readGraph(join(outDir, GRAPH_FILE));
  if (!committed) {
    result.missing = true;
    return result;
  }

  // Freshly extract Tier-1 nodes from the code on disk (same file set as build).
  const current = new Map<string, string>(); // id → body_hash
  for (const file of listSourceFiles(root, outDir)) {
    const lang = languageOf(file)!;
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // unreadable now → its nodes show up as `removed` below
    }
    try {
      const { nodes } = extractFile(relative(root, file), source, lang);
      for (const n of nodes) current.set(n.id, n.body_hash);
    } catch {
      // parse failure → skip; the committed nodes for this file become `removed`.
    }
  }

  const committedById = new Map(committed.nodes.map((n) => [n.id, n]));
  for (const [id, node] of committedById) {
    const now = current.get(id);
    if (now === undefined) result.removed.push(id);
    else if (now !== node.body_hash) result.changed.push(id);
    if (node.summary_state === "stale") result.stale.push(id);
    if (node.summary_state === "pending") result.pending++;
  }
  for (const id of current.keys()) {
    if (!committedById.has(id)) result.added.push(id);
  }

  for (const arr of [result.added, result.removed, result.changed, result.stale]) arr.sort();

  result.ok =
    result.added.length === 0 &&
    result.removed.length === 0 &&
    result.changed.length === 0 &&
    result.stale.length === 0;
  return result;
}

/** Render a graph-check result as a human-readable report. */
export function formatGraphCheckReport(r: GraphCheckResult): string {
  if (r.missing) {
    return "graph check: NO GRAPH\n\nNo .context/graph.json found. Run `graft graph` first.";
  }
  if (r.ok) {
    const note = r.pending ? ` (${r.pending} node(s) not yet summarized — run \`graph --llm\`)` : "";
    return `graph check: OK — graph.json is in sync with the code.${note}`;
  }

  const lines: string[] = ["graph check: STALE", ""];
  const structural = r.added.length + r.removed.length + r.changed.length;
  if (r.changed.length) {
    lines.push(`changed (${r.changed.length}):`);
    for (const id of r.changed) lines.push(`  ~ ${id}`);
  }
  if (r.added.length) {
    lines.push(`added (${r.added.length}):`);
    for (const id of r.added) lines.push(`  + ${id}`);
  }
  if (r.removed.length) {
    lines.push(`removed (${r.removed.length}):`);
    for (const id of r.removed) lines.push(`  - ${id}`);
  }
  if (r.stale.length) {
    lines.push(`stale summaries (${r.stale.length}):`);
    for (const id of r.stale) lines.push(`  ! ${id}`);
  }
  lines.push("");
  if (structural) lines.push("Run `graft graph` to rebuild the structure, then commit .context/.");
  if (r.stale.length) lines.push("Run `graft graph --llm` to refresh stale summaries.");
  return lines.join("\n");
}
