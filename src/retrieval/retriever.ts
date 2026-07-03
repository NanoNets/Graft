import type { GraphStore } from "../graph/store.js";
import type { Embedder } from "../ai/providers.js";
import type {
  ContextBundle,
  GraphEdge,
  GraphNode,
  RetrievedChunk,
  RetrievedNode,
} from "../graph/types.js";
import { topK } from "../util/similarity.js";

export interface RetrieveOptions {
  /** Max entities to surface via direct semantic match. Default: 8. */
  maxNodes?: number;
  /** Max supporting source passages to include. Default: 6. */
  maxChunks?: number;
  /** Whether to expand one hop out from the semantically-matched nodes. Default: true. */
  expand?: boolean;
  /** Drop semantic node hits scoring below this cosine value. Default: 0.15. */
  minNodeScore?: number;
}

/**
 * Read the graph for a query: semantic-match entities and passages, then expand
 * one hop across relationships to pull in connected context. Returns a
 * structured {@link ContextBundle} plus a ready-to-inject `prompt` rendering.
 */
export async function retrieve(
  store: GraphStore,
  embedder: Embedder,
  query: string,
  opts: RetrieveOptions = {},
): Promise<ContextBundle> {
  const maxNodes = opts.maxNodes ?? 8;
  const maxChunks = opts.maxChunks ?? 6;
  const expand = opts.expand ?? true;
  const minNodeScore = opts.minNodeScore ?? 0.15;

  const [queryVec] = await embedder.embed([query]);

  // 1) Direct semantic matches over entities.
  const nodeHits = topK(queryVec, store.allEmbeddedNodes(), (n) => n.embedding, maxNodes)
    .filter((h) => h.score >= minNodeScore);

  const nodesById = new Map<string, RetrievedNode>();
  for (const { item, score } of nodeHits) {
    nodesById.set(item.id, { ...item, score, via: "semantic" });
  }

  // 2) One-hop graph expansion from the matched entities.
  let edges: GraphEdge[] = [];
  if (expand && nodesById.size > 0) {
    const seedIds = [...nodesById.keys()];
    edges = store.edgesForNodes(seedIds);

    const neighborIds = new Set<string>();
    for (const e of edges) {
      if (!nodesById.has(e.sourceId)) neighborIds.add(e.sourceId);
      if (!nodesById.has(e.targetId)) neighborIds.add(e.targetId);
    }
    const neighbors = store.getNodesByIds([...neighborIds]);
    const seedScore = new Map(nodeHits.map((h) => [h.item.id, h.score]));
    for (const n of neighbors) {
      // Score an expanded node by the best edge that reached it.
      const best = bestEdgeScore(n.id, edges, seedScore);
      nodesById.set(n.id, { ...n, score: best, via: "expanded" });
    }
  }

  // Keep only edges whose endpoints are both in the final node set.
  const finalNodes = [...nodesById.values()].sort((a, b) => b.score - a.score);
  const nodeIdSet = new Set(finalNodes.map((n) => n.id));
  edges = edges.filter((e) => nodeIdSet.has(e.sourceId) && nodeIdSet.has(e.targetId));

  // 3) Supporting source passages.
  const chunkHits = topK(queryVec, store.allEmbeddedChunks(), (c) => c.embedding, maxChunks);
  const chunks: RetrievedChunk[] = chunkHits.map(({ item, score }) => ({
    ...item,
    score,
    documentTitle: store.documentTitle(item.documentId),
  }));

  const bundle: ContextBundle = {
    query,
    nodes: finalNodes,
    edges,
    chunks,
    prompt: "",
  };
  bundle.prompt = renderPrompt(bundle);
  return bundle;
}

function bestEdgeScore(
  nodeId: string,
  edges: GraphEdge[],
  seedScore: Map<string, number>,
): number {
  let best = 0;
  for (const e of edges) {
    const other =
      e.sourceId === nodeId ? e.targetId : e.targetId === nodeId ? e.sourceId : null;
    if (other === null) continue;
    const seed = seedScore.get(other);
    if (seed === undefined) continue;
    best = Math.max(best, seed * e.confidence);
  }
  return best;
}

/** Render a bundle into a compact, LLM-friendly context block. */
export function renderPrompt(bundle: ContextBundle): string {
  const lines: string[] = [];
  lines.push(`# Context for: ${bundle.query}`);

  if (bundle.nodes.length > 0) {
    lines.push("\n## Relevant entities");
    for (const n of bundle.nodes) {
      const conf = `${Math.round(n.confidence * 100)}%`;
      lines.push(`- **${n.name}** (${n.type}, confidence ${conf}): ${n.summary}`);
    }
  }

  if (bundle.edges.length > 0) {
    const byId = new Map(bundle.nodes.map((n) => [n.id, n.name]));
    lines.push("\n## Relationships");
    for (const e of bundle.edges) {
      const s = byId.get(e.sourceId) ?? e.sourceId;
      const t = byId.get(e.targetId) ?? e.targetId;
      const desc = e.description ? ` — ${e.description}` : "";
      lines.push(`- ${s} —[${e.relation}]→ ${t}${desc}`);
    }
  }

  if (bundle.chunks.length > 0) {
    lines.push("\n## Supporting sources");
    for (const c of bundle.chunks) {
      lines.push(`- (${c.documentTitle}) ${c.text.replace(/\s+/g, " ").slice(0, 400)}`);
    }
  }

  if (bundle.nodes.length === 0 && bundle.chunks.length === 0) {
    lines.push("\n_No relevant context found in the graph yet._");
  }

  return lines.join("\n");
}
