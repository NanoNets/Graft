/**
 * Git-native team sync (Mode A): serialize the whole graph to a single
 * human-diffable JSONL file that a team commits to their repo, and import it
 * back with a conflict-free re-merge.
 *
 * The file is line-delimited JSON — one record per line, in FK-safe order
 * (meta, documents, nodes, edges, chunks) — so `git diff` shows exactly which
 * facts changed. Importing runs the CRDT record-merge ({@link mergeNodeRecords}
 * / {@link mergeEdgeRecords}), which is idempotent: pulling the same file twice
 * changes nothing, and two teammates' additions converge regardless of order.
 */
import type { GraphStore } from "./store.js";
import type { Chunk, GraphDocument, GraphEdge, GraphNode } from "./types.js";
import { mergeEdgeRecords, mergeNodeRecords } from "./merge.js";
import { normalizeName } from "../util/id.js";

/** Current on-disk format version. Bumped if the record shape changes. */
export const GRAPH_FILE_FORMAT = 1;

interface GraphFileMeta {
  kind: "meta";
  format: number;
  /** Embedding dimensionality of the graph that produced this file. */
  embeddingDimensions: number;
  /** Optional embedding-model label, to warn on cross-model drift. */
  embeddingModel?: string;
  exportedAt: string;
  counts: { documents: number; nodes: number; edges: number; chunks: number };
}

export interface SerializeOptions {
  embeddingDimensions: number;
  embeddingModel?: string;
  /** Decimal places to round embeddings to (smaller = tidier git diffs). Default 6. */
  precision?: number;
}

export interface ImportResult {
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesUpdated: number;
  documentsAdded: number;
  chunksAdded: number;
  /** Non-fatal problems (e.g. embedding-model mismatch), for the caller to surface. */
  warnings: string[];
}

function round(vec: number[] | undefined, precision: number): number[] | undefined {
  if (!vec) return undefined;
  const f = 10 ** precision;
  return vec.map((x) => Math.round(x * f) / f);
}

/** Serialize the entire graph to a JSONL string. */
export async function serializeGraph(
  store: GraphStore,
  opts: SerializeOptions,
): Promise<string> {
  const precision = opts.precision ?? 6;
  const [documents, nodes, edges, chunks] = await Promise.all([
    store.allDocuments(),
    store.allNodes(),
    store.allEdges(),
    store.allChunks(),
  ]);

  const meta: GraphFileMeta = {
    kind: "meta",
    format: GRAPH_FILE_FORMAT,
    embeddingDimensions: opts.embeddingDimensions,
    embeddingModel: opts.embeddingModel,
    exportedAt: new Date().toISOString(),
    counts: {
      documents: documents.length,
      nodes: nodes.length,
      edges: edges.length,
      chunks: chunks.length,
    },
  };

  const lines: string[] = [JSON.stringify(meta)];
  // Deterministic ordering keeps diffs stable across exports.
  for (const d of [...documents].sort(byId)) lines.push(JSON.stringify({ kind: "document", ...d }));
  for (const n of [...nodes].sort(byId)) {
    lines.push(JSON.stringify({ kind: "node", ...n, embedding: round(n.embedding, precision) }));
  }
  for (const e of [...edges].sort(byId)) lines.push(JSON.stringify({ kind: "edge", ...e }));
  for (const c of [...chunks].sort(byId)) {
    lines.push(JSON.stringify({ kind: "chunk", ...c, embedding: round(c.embedding, precision) }));
  }
  return lines.join("\n") + "\n";
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Import a serialized graph into a store, CRDT-merging every record. Idempotent:
 * importing the same content twice is a no-op.
 *
 * @param embeddingDimensions  The importing graph's embedding size; a mismatch
 *   means the incoming vectors aren't comparable, so they're dropped (a warning
 *   is returned) rather than corrupting retrieval.
 */
export async function importGraph(
  store: GraphStore,
  jsonl: string,
  embeddingDimensions: number,
): Promise<ImportResult> {
  const result: ImportResult = {
    nodesCreated: 0,
    nodesUpdated: 0,
    edgesCreated: 0,
    edgesUpdated: 0,
    documentsAdded: 0,
    chunksAdded: 0,
    warnings: [],
  };

  const documents: GraphDocument[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const chunks: Chunk[] = [];
  let dropEmbeddings = false;

  for (const raw of jsonl.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const rec = JSON.parse(line) as { kind: string } & Record<string, unknown>;
    switch (rec.kind) {
      case "meta": {
        const meta = rec as unknown as GraphFileMeta;
        if (meta.embeddingDimensions && meta.embeddingDimensions !== embeddingDimensions) {
          dropEmbeddings = true;
          result.warnings.push(
            `Embedding dimension mismatch (file ${meta.embeddingDimensions} vs local ${embeddingDimensions}` +
              (meta.embeddingModel ? `, model "${meta.embeddingModel}"` : "") +
              `). Imported facts kept; their embeddings were dropped, so re-embed by re-ingesting sources.`,
          );
        }
        break;
      }
      case "document":
        documents.push(stripKind(rec) as unknown as GraphDocument);
        break;
      case "node":
        nodes.push(stripKind(rec) as unknown as GraphNode);
        break;
      case "edge":
        edges.push(stripKind(rec) as unknown as GraphEdge);
        break;
      case "chunk":
        chunks.push(stripKind(rec) as unknown as Chunk);
        break;
    }
  }

  // Documents (dedup by content hash; remember any id remap for chunks).
  const docIdMap = new Map<string, string>();
  for (const doc of documents) {
    const existing = await store.getDocumentByHash(doc.hash);
    if (existing) {
      docIdMap.set(doc.id, existing.id);
    } else {
      await store.insertDocument(doc);
      docIdMap.set(doc.id, doc.id);
      result.documentsAdded += 1;
    }
  }

  // Nodes (resolve identity by id, then by name; remember id remap for edges).
  const nodeIdMap = new Map<string, string>();
  for (const incoming of nodes) {
    if (dropEmbeddings) incoming.embedding = undefined;
    const byId = await store.getNodeById(incoming.id);
    if (byId) {
      await store.upsertNode(mergeNodeRecords(byId, incoming));
      nodeIdMap.set(incoming.id, byId.id);
      result.nodesUpdated += 1;
      continue;
    }
    const byName = (await store.findNodesByName(normalizeName(incoming.name))).sort(
      (a, b) => b.observations - a.observations,
    )[0];
    if (byName) {
      await store.upsertNode(mergeNodeRecords(byName, incoming));
      nodeIdMap.set(incoming.id, byName.id);
      result.nodesUpdated += 1;
    } else {
      await store.upsertNode(incoming);
      nodeIdMap.set(incoming.id, incoming.id);
      result.nodesCreated += 1;
    }
  }

  // Edges (remap endpoints, then merge on the (source, target, relation) key).
  for (const incoming of edges) {
    const sourceId = nodeIdMap.get(incoming.sourceId) ?? incoming.sourceId;
    const targetId = nodeIdMap.get(incoming.targetId) ?? incoming.targetId;
    const mapped: GraphEdge = { ...incoming, sourceId, targetId };
    const existing = await store.findEdge(sourceId, targetId, incoming.relation);
    if (existing) {
      await store.upsertEdge(mergeEdgeRecords(existing, mapped));
      result.edgesUpdated += 1;
    } else {
      await store.upsertEdge(mapped);
      result.edgesCreated += 1;
    }
  }

  // Chunks (grow-only; skip ones we already have or whose document is absent).
  for (const incoming of chunks) {
    if (dropEmbeddings) incoming.embedding = undefined;
    const documentId = docIdMap.get(incoming.documentId) ?? incoming.documentId;
    if (!(await store.getDocumentById(documentId))) continue;
    const present = await store.getChunksByIds([incoming.id]);
    if (present.length > 0) continue;
    await store.insertChunk({ ...incoming, documentId });
    result.chunksAdded += 1;
  }

  return result;
}

function stripKind(rec: Record<string, unknown>): Record<string, unknown> {
  const { kind, ...rest } = rec;
  void kind;
  return rest;
}
