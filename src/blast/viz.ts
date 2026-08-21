/**
 * The blast radius as a graph the viewer can draw — the hosted half of the PR
 * comment.
 *
 * The comment can hold about five circles before it stops being readable, and it
 * can never answer the reviewer's next question: which symbols, at which lines.
 * `graft viz --export` already produces a self-contained page, but its Context tab
 * is assembled from the deep tier's concept files, which the PR path deliberately
 * no longer builds — so on a structural build that tab held a single INDEX dot.
 *
 * This closes that gap with no new data and no LLM pass: `blast` has already
 * clustered both sides of the diff and named them (cached, one call), so the same
 * report is emitted here as {@link VizGraph} — amber node per changed area, blue
 * node per affected area, one edge per attribution the walk actually recorded. The
 * comment becomes a summary of this page rather than a separate computation.
 */
import type { VizEdge, VizGraph, VizNode } from "../viz/assemble.js";
import type { BlastReport, ChangedArea, ImpactedModule, TestSignal } from "./blast.js";

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Node-type names, which double as the viewer's legend labels. */
const CHANGED = "changed";
const AFFECTED = "affected";

const TEST_NOTE: Record<TestSignal, string> = {
  changed: "a test that reaches it changed too",
  stale: "it has tests, and this diff did not touch them",
  none: "no test reaches it",
  na: "no function, method or class changed here",
};

function changedNode(a: ChangedArea): VizNode {
  const reach = a.behavioural > 0 ? ` ${a.reached} of ${a.behavioural} changed functions have a test that reaches them.` : "";
  return {
    id: `changed:${a.key}`,
    name: a.label,
    type: CHANGED,
    summary: `Changed in this PR: ${plural(a.files.length, "file")}, ${plural(a.seeds, "symbol")}. ${TEST_NOTE[a.tests]}.${reach}`,
    sources: a.files,
  };
}

function affectedNode(m: ImpactedModule): VizNode {
  const nearest = m.symbols[0];
  const how = nearest ? ` Nearest hop: ${nearest.name} at depth ${nearest.depth} (${nearest.relation}).` : "";
  return {
    id: `affected:${m.key}`,
    name: m.label,
    type: AFFECTED,
    summary: `Can be affected by this PR: ${plural(m.symbols.length, "dependent symbol")} in ${plural(m.files.length, "file")}.${how}`,
    // `path · span` is the shape the viewer's detail panel already renders, so each
    // line is the exact place to start reading.
    sources: m.symbols.map((s) => `${s.path} · ${s.span}`),
  };
}

/**
 * What an empty canvas means.
 *
 * A PR that only touches lockfiles, workflows or docs has no radius, and the page
 * published for it used to be a blank canvas behind a link promising a graph — a
 * reader cannot tell that from a broken export. Naming the reason (usually: no
 * parser claims these files) turns it into an answer.
 */
function emptyNote(r: BlastReport): string {
  if (r.changed.length === 0) return "This pull request changes no files.";
  if (r.unindexed.length === r.changed.length) {
    const shown = r.unindexed.slice(0, 3).join(", ");
    const rest = r.unindexed.length > 3 ? `, +${r.unindexed.length - 3} more` : "";
    return `Nothing to draw: no parser claims ${plural(r.unindexed.length, "changed file")} (${shown}${rest}), so this change has no symbols to trace.`;
  }
  return "Nothing to draw: the changed symbols have no resolved dependents at this depth.";
}

/**
 * Build the viewer graph for a report.
 *
 * Nothing is capped here. The caps in the markdown renderer exist because a Mermaid
 * diagram inside a comment cannot lay out more than a handful of circles; this page
 * is force-directed and pannable, which is the entire reason it exists.
 */
export function blastVizGraph(r: BlastReport): VizGraph {
  const nodes: VizNode[] = [...r.areas.map(changedNode), ...r.modules.map(affectedNode)];
  /** Changed path → the id of the area node standing for it. */
  const areaOf = new Map<string, string>();
  for (const a of r.areas) for (const f of a.files) areaOf.set(f, `changed:${a.key}`);

  const edges: VizEdge[] = [];
  const seen = new Set<string>();
  for (const m of r.modules) {
    for (const from of m.from) {
      const source = areaOf.get(from);
      if (!source) continue; // a changed test file: the signal, not an area
      const affected = `affected:${m.key}`;
      const key = `${affected}→${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Edge direction is the DEPENDENCY, affected → changed, not the impact. The
      // viewer words its panels "depends on" / "depended on by" from the edge, so
      // pointing it the other way made an affected area read as the thing being
      // depended upon — backwards, on the one screen a reviewer is reading closely.
      edges.push({
        source: affected,
        target: source,
        relation: "depends_on",
        description: "this area calls or imports code the PR changed",
      });
    }
  }

  return {
    meta: {
      nodeCount: nodes.length,
      emptyNote: nodes.length === 0 ? emptyNote(r) : undefined,
      edgeCount: edges.length,
      // Changed files no parser claims: named here so a thin graph is explained
      // rather than read as "this PR is safe".
      skippedFiles: r.unindexed.length,
      droppedEdges: 0,
    },
    nodes,
    edges,
  };
}
