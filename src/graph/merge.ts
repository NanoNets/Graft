import type { GraphStore } from "./store.js";
import type { Embedder } from "../ai/providers.js";
import type {
  Extraction,
  GraphEdge,
  GraphNode,
} from "./types.js";
import { newId, normalizeName } from "../util/id.js";
import { cosineSimilarity } from "../util/similarity.js";
import {
  bumpObservation,
  confidenceFromObservations,
  mergeObservationCounters,
  pickLatestText,
  totalObservations,
  unionSet,
} from "./crdt.js";

/** Pick the more informative of two summaries (prefers the longer, richer one). */
function betterSummary(existing: string, incoming: string): string {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.length > existing.length * 1.2 ? incoming : existing;
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
 * Merge an {@link Extraction} into the graph (the *live* write path used by
 * ingest/contribute).
 *
 * Entities are matched against existing nodes by (a) exact normalized name /
 * alias and (b) embedding similarity above `mergeThreshold`. A match records a
 * fresh observation under `observationKey` (a bump of the CRDT counter);
 * confidence is then *derived* from the new total, never mutated directly.
 * Non-matches are created. Relations are linked between resolved node ids,
 * deduped by (source, target, relation).
 *
 * @param provenance      Human-facing origin label added to the grow-only set
 *                        (e.g. `doc:<id>` or `agent:<id>`).
 * @param observationKey  Globally-unique key for *this* observation event
 *                        (the document/contribution id), so re-observing the
 *                        same event later is idempotent under counter merge.
 */
export async function mergeExtraction(
  store: GraphStore,
  embedder: Embedder,
  extraction: Extraction,
  provenance: string,
  observationKey: string,
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
    const candidatePool = await store.allEmbeddedNodes();

    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      const embedding = embeddings[i];
      const norm = normalizeName(ent.name);
      const aliases = unionSet([norm], (ent.aliases ?? []).map(normalizeName));

      const match = await findMatch(store, candidatePool, norm, aliases, embedding, mergeThreshold);

      if (match) {
        const summary = betterSummary(match.summary, ent.summary);
        if (summary !== match.summary) {
          match.summary = summary;
          match.summaryUpdatedAt = now;
        }
        match.aliases = unionSet(match.aliases, [...aliases, norm]);
        bumpObservation(match.observationSources, observationKey);
        match.observations = totalObservations(match.observationSources);
        match.confidence = confidenceFromObservations(match.observations);
        match.provenance = unionSet(match.provenance, [provenance]);
        match.embedding = embedding;
        match.updatedAt = now;
        await store.upsertNode(match);
        result.nameToId.set(norm, match.id);
        result.nodesUpdated += 1;
      } else {
        const node: GraphNode = {
          id: newId("node"),
          name: ent.name,
          type: ent.type,
          summary: ent.summary,
          summaryUpdatedAt: now,
          aliases,
          confidence: confidenceFromObservations(1),
          observations: 1,
          observationSources: { [observationKey]: 1 },
          embedding,
          provenance: [provenance],
          createdAt: now,
          updatedAt: now,
        };
        await store.upsertNode(node);
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
    const existing = await store.findEdge(sourceId, targetId, relation);
    if (existing) {
      const description = betterSummary(existing.description, rel.description ?? "");
      if (description !== existing.description) {
        existing.description = description;
        existing.descriptionUpdatedAt = now;
      }
      bumpObservation(existing.observationSources, observationKey);
      existing.observations = totalObservations(existing.observationSources);
      existing.confidence = confidenceFromObservations(existing.observations);
      existing.provenance = unionSet(existing.provenance, [provenance]);
      existing.updatedAt = now;
      await store.upsertEdge(existing);
      result.edgesUpdated += 1;
    } else {
      const edge: GraphEdge = {
        id: newId("edge"),
        sourceId,
        targetId,
        relation,
        description: rel.description ?? "",
        descriptionUpdatedAt: now,
        confidence: confidenceFromObservations(1),
        observations: 1,
        observationSources: { [observationKey]: 1 },
        provenance: [provenance],
        createdAt: now,
        updatedAt: now,
      };
      await store.upsertEdge(edge);
      result.edgesCreated += 1;
    }
  }

  return result;
}

/** Find the best existing node to merge an incoming entity into, or undefined. */
async function findMatch(
  store: GraphStore,
  candidatePool: GraphNode[],
  norm: string,
  aliases: string[],
  embedding: number[],
  threshold: number,
): Promise<GraphNode | undefined> {
  // 1) Exact name/alias hit is authoritative.
  const byName = await store.findNodesByName(norm);
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

/**
 * Reconcile two *full node records* for the same logical entity — the CRDT merge
 * used when importing a serialized graph from a teammate (Mode A) or a replica.
 *
 * Unlike {@link mergeExtraction}, this does not add a new observation: it takes
 * the element-wise **max** of the two observation counters (idempotent — a
 * re-import is a no-op), unions the grow-only sets, and resolves free text by
 * last-writer-wins. The result is independent of merge order.
 */
export function mergeNodeRecords(existing: GraphNode, incoming: GraphNode): GraphNode {
  const observationSources = mergeObservationCounters(
    existing.observationSources,
    incoming.observationSources,
  );
  const observations = totalObservations(observationSources);
  const summary = pickLatestText(
    { text: existing.summary, at: existing.summaryUpdatedAt },
    { text: incoming.summary, at: incoming.summaryUpdatedAt },
  );
  return {
    ...existing,
    // Keep the canonical name/type of the record we already have, but retain
    // both surface forms as aliases so either resolves to this node.
    aliases: unionSet(existing.aliases, incoming.aliases),
    summary: summary.text,
    summaryUpdatedAt: summary.at,
    confidence: confidenceFromObservations(observations),
    observations,
    observationSources,
    provenance: unionSet(existing.provenance, incoming.provenance),
    embedding: existing.embedding ?? incoming.embedding,
    createdAt: minStr(existing.createdAt, incoming.createdAt),
    updatedAt: maxStr(existing.updatedAt, incoming.updatedAt),
  };
}

/** CRDT reconciliation of two edge records for the same (source, target, relation). */
export function mergeEdgeRecords(existing: GraphEdge, incoming: GraphEdge): GraphEdge {
  const observationSources = mergeObservationCounters(
    existing.observationSources,
    incoming.observationSources,
  );
  const observations = totalObservations(observationSources);
  const description = pickLatestText(
    { text: existing.description, at: existing.descriptionUpdatedAt },
    { text: incoming.description, at: incoming.descriptionUpdatedAt },
  );
  return {
    ...existing,
    description: description.text,
    descriptionUpdatedAt: description.at,
    confidence: confidenceFromObservations(observations),
    observations,
    observationSources,
    provenance: unionSet(existing.provenance, incoming.provenance),
    createdAt: minStr(existing.createdAt, incoming.createdAt),
    updatedAt: maxStr(existing.updatedAt, incoming.updatedAt),
  };
}

function minStr(a: string, b: string): string {
  return a <= b ? a : b;
}
function maxStr(a: string, b: string): string {
  return a >= b ? a : b;
}
