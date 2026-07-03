import type { GraphStore } from "./store.js";
import type { Embedder } from "../ai/providers.js";
import type {
  Extraction,
  GraphEdge,
  GraphNode,
} from "./types.js";
import { newId, normalizeName } from "../util/id.js";
import { cosineSimilarity } from "../util/similarity.js";

/** Reinforce a confidence score toward 1 as evidence accumulates. */
function reinforce(confidence: number): number {
  return Math.min(0.99, confidence + (1 - confidence) * 0.2);
}

/** Pick the more informative of two summaries (prefers the longer, richer one). */
function betterSummary(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.length > existing.length * 1.2 ? incoming : existing;
}

function uniq(values: string[]): string[] {
  return [...new Set(values.filter((v) => v && v.length > 0))];
}

export interface MergeResult {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesUpdated: number;
  /** Maps normalized entity name -> node id, so callers can link chunks/edges. */
  nameToId: Map<string, string>;
}

/**
 * Merge an {@link Extraction} into the graph.
 *
 * Entities are matched against existing nodes by (a) exact normalized name /
 * alias and (b) embedding similarity above `mergeThreshold`. Matches are
 * reinforced (confidence up, observation count up, provenance appended);
 * non-matches are created. Relations are then linked between the resolved node
 * ids, deduped by (source, target, relation).
 */
export async function mergeExtraction(
  store: GraphStore,
  embedder: Embedder,
  extraction: Extraction,
  provenance: string,
  mergeThreshold: number,
  now: string,
): Promise<MergeResult> {
  const result: MergeResult = {
    nodesCreated: 0,
    nodesUpdated: 0,
    edgesCreated: 0,
    edgesUpdated: 0,
    nameToId: new Map(),
  };

  const entities = extraction.entities;
  if (entities.length > 0) {
    // Embed all incoming entities in one batch.
    const embedInputs = entities.map((e) => `${e.name}: ${e.summary}`);
    const embeddings = await embedder.embed(embedInputs);

    // Cache the full embedded-node set once; refresh with nodes we create so
    // duplicates *within this same extraction* also collapse.
    const candidatePool = store.allEmbeddedNodes();

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      const embedding = embeddings[i];
      const norm = normalizeName(ent.name);
      const aliases = uniq([norm, ...(ent.aliases ?? []).map(normalizeName)]);

      const match = findMatch(store, candidatePool, norm, aliases, embedding, mergeThreshold);

      if (match) {
        match.summary = betterSummary(match.summary, ent.summary);
        match.aliases = uniq([...match.aliases, ...aliases, norm]);
        match.confidence = reinforce(match.confidence);
        match.observations += 1;
        match.provenance = uniq([...match.provenance, provenance]);
        match.embedding = embedding;
        match.updatedAt = now;
        store.upsertNode(match);
        result.nameToId.set(norm, match.id);
        result.nodesUpdated += 1;
      } else {
        const node: GraphNode = {
          id: newId("node"),
          name: ent.name,
          type: ent.type,
          summary: ent.summary,
          aliases,
          confidence: 0.6,
          observations: 1,
          embedding,
          provenance: [provenance],
          createdAt: now,
          updatedAt: now,
        };
        store.upsertNode(node);
        candidatePool.push(node); // allow intra-batch dedup
        result.nameToId.set(norm, node.id);
        result.nodesCreated += 1;
      }
    }
  }

  // Link relations between resolved nodes.
  for (const rel of extraction.relations) {
    const sourceId = result.nameToId.get(normalizeName(rel.source));
    const targetId = result.nameToId.get(normalizeName(rel.target));
    if (!sourceId || !targetId || sourceId === targetId) continue;

    const relation = normalizeName(rel.relation).replace(/\s+/g, "_");
    const existing = store.findEdge(sourceId, targetId, relation);
    if (existing) {
      existing.description = betterSummary(existing.description, rel.description ?? "");
      existing.confidence = reinforce(existing.confidence);
      existing.observations += 1;
      existing.provenance = uniq([...existing.provenance, provenance]);
      existing.updatedAt = now;
      store.upsertEdge(existing);
      result.edgesUpdated += 1;
    } else {
      const edge: GraphEdge = {
        id: newId("edge"),
        sourceId,
        targetId,
        relation,
        description: rel.description ?? "",
        confidence: 0.6,
        observations: 1,
        provenance: [provenance],
        createdAt: now,
        updatedAt: now,
      };
      store.upsertEdge(edge);
      result.edgesCreated += 1;
    }
  }

  return result;
}

/** Find the best existing node to merge an incoming entity into, or undefined. */
function findMatch(
  store: GraphStore,
  candidatePool: GraphNode[],
  norm: string,
  aliases: string[],
  embedding: number[],
  threshold: number,
): GraphNode | undefined {
  // 1) Exact name/alias hit is authoritative.
  const byName = store.findNodesByName(norm);
  if (byName.length > 0) {
    // Prefer the most-observed among exact matches.
    return byName.sort((a, b) => b.observations - a.observations)[0];
  }

  // 2) Otherwise, semantic match above the threshold.
  let best: GraphNode | undefined;
  let bestScore = threshold;
  for (const node of candidatePool) {
    if (!node.embedding) continue;
    // Alias overlap is a strong signal; give it a small boost.
    const aliasOverlap = node.aliases.some((a) => aliases.includes(a)) ? 0.05 : 0;
    const score = cosineSimilarity(embedding, node.embedding) + aliasOverlap;
    if (score >= bestScore) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}
