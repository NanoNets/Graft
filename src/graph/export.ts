import type { GraphStore } from "./store.js";
import type { GraphEdge, GraphNode } from "./types.js";

/** A plain, serializable snapshot of the whole graph. */
export interface GraphExport {
  nodes: Array<Pick<GraphNode, "id" | "name" | "type" | "summary" | "confidence" | "observations">>;
  edges: Array<Pick<GraphEdge, "sourceId" | "targetId" | "relation" | "description" | "confidence">>;
}

/** Read the entire graph out of a store into a serializable snapshot. */
export function buildGraphExport(store: GraphStore): GraphExport {
  const nodes = store.allNodes().map((n) => ({
    id: n.id,
    name: n.name,
    type: n.type,
    summary: n.summary,
    confidence: n.confidence,
    observations: n.observations,
  }));
  const edges = store.allEdges().map((e) => ({
    sourceId: e.sourceId,
    targetId: e.targetId,
    relation: e.relation,
    description: e.description,
    confidence: e.confidence,
  }));
  return { nodes, edges };
}

/** Render the graph as a Mermaid `graph LR` definition (handy for docs/markdown). */
export function toMermaid(g: GraphExport): string {
  const safe = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
  const lines = ["graph LR"];
  for (const n of g.nodes) {
    lines.push(`  ${safe(n.id)}["${n.name.replace(/"/g, "'")} (${n.type})"]`);
  }
  for (const e of g.edges) {
    lines.push(`  ${safe(e.sourceId)} -->|${e.relation}| ${safe(e.targetId)}`);
  }
  return lines.join("\n");
}

/**
 * Render the graph as a self-contained, interactive HTML page.
 *
 * Uses vis-network (loaded from a CDN) for a draggable/zoomable force layout —
 * the graph data itself is embedded inline, so the only network dependency is
 * the viz library. Nodes are colored by type and sized by observation count.
 */
export function toHtml(g: GraphExport, title = "Context Graph"): string {
  const palette = [
    "#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626",
    "#7c3aed", "#db2777", "#65a30d", "#0284c7", "#ca8a04",
  ];
  const types = [...new Set(g.nodes.map((n) => n.type))];
  const colorFor = (t: string) => palette[types.indexOf(t) % palette.length];

  const nodes = g.nodes.map((n) => ({
    id: n.id,
    label: n.name,
    title: `${n.name} (${n.type})\nconfidence ${Math.round(n.confidence * 100)}% · ${n.observations} observation(s)\n${n.summary}`,
    group: n.type,
    value: n.observations,
    color: colorFor(n.type),
  }));
  const edges = g.edges.map((e) => ({
    from: e.sourceId,
    to: e.targetId,
    label: e.relation,
    title: e.description || e.relation,
    width: 1 + e.confidence * 2,
  }));

  const legend = types
    .map((t) => `<span class="chip"><i style="background:${colorFor(t)}"></i>${t}</span>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"
  integrity="sha384-yxKDWWf0wwdUj/gPeuL11czrnKFQROnLgY8ll7En9NYoXibgg3C6NK/UDHNtUgWJ"
  crossorigin="anonymous"></script>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  header { padding: 12px 16px; border-bottom: 1px solid #8883; }
  h1 { font-size: 16px; margin: 0 0 6px; }
  .meta { font-size: 12px; opacity: 0.7; }
  .legend { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
  .chip i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  #graph { width: 100vw; height: calc(100vh - 92px); }
</style>
</head>
<body>
<header>
  <h1>${title}</h1>
  <div class="meta">${g.nodes.length} entities · ${g.edges.length} relationships</div>
  <div class="legend">${legend}</div>
</header>
<div id="graph"></div>
<script>
  const nodes = new vis.DataSet(${JSON.stringify(nodes)});
  const edges = new vis.DataSet(${JSON.stringify(edges)});
  new vis.Network(document.getElementById("graph"), { nodes, edges }, {
    nodes: { shape: "dot", scaling: { min: 8, max: 32 }, font: { size: 14 } },
    edges: { arrows: "to", font: { size: 10, align: "middle" }, color: { opacity: 0.5 }, smooth: { type: "dynamic" } },
    physics: { stabilization: true, barnesHut: { gravitationalConstant: -8000, springLength: 140 } },
    interaction: { hover: true, tooltipDelay: 120 },
  });
</script>
</body>
</html>`;
}
