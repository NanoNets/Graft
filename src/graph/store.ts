import type {
  Chunk,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphStats,
} from "./types.js";

/**
 * Storage backend for the context graph.
 *
 * The engine talks to the graph exclusively through this interface, so the
 * default local SQLite backend can be swapped for another store — a
 * Postgres/pgvector service, a remote replica, or an in-memory store — without
 * touching engine logic.
 *
 * All methods are **async**. The local `better-sqlite3` store is synchronous
 * under the hood and simply resolves immediately; a networked store needs the
 * async surface to talk to its remote.
 */
export interface GraphStore {
  // --- documents ---
  getDocumentByHash(hash: string): Promise<GraphDocument | undefined>;
  getDocumentById(id: string): Promise<GraphDocument | undefined>;
  /** All documents recorded with the given source (path/URL/label), newest first. */
  documentsBySource(source: string): Promise<GraphDocument[]>;
  insertDocument(doc: GraphDocument): Promise<void>;
  /**
   * Delete a document and its chunks (e.g. when re-ingesting a changed file).
   * Nodes/edges extracted from it keep their observations — the grow-only CRDT
   * counters never shrink.
   */
  deleteDocument(id: string): Promise<void>;
  /** Every ingested document, newest first (for UI listings). */
  allDocuments(): Promise<GraphDocument[]>;

  // --- chunks ---
  insertChunk(chunk: Chunk): Promise<void>;
  getChunksByIds(ids: string[]): Promise<Chunk[]>;
  /** All chunks that have an embedding, for in-memory vector search. */
  allEmbeddedChunks(): Promise<Chunk[]>;
  /** Every chunk in the graph (for serialization / export). */
  allChunks(): Promise<Chunk[]>;

  // --- nodes ---
  getNodeById(id: string): Promise<GraphNode | undefined>;
  getNodesByIds(ids: string[]): Promise<GraphNode[]>;
  /** Nodes whose canonical name or an alias matches (normalized, exact). */
  findNodesByName(normalizedName: string): Promise<GraphNode[]>;
  /** All nodes that have an embedding, for in-memory vector search & dedup. */
  allEmbeddedNodes(): Promise<GraphNode[]>;
  /** Every node in the graph (for export/visualization). */
  allNodes(): Promise<GraphNode[]>;
  upsertNode(node: GraphNode): Promise<void>;
  /**
   * Delete a node and (via the edge foreign keys) every edge incident to it.
   * Used by the pruning path when a node's last supporting source disappears.
   */
  deleteNode(id: string): Promise<void>;

  // --- edges ---
  /** Existing edge with the same (source, target, relation), if any. */
  findEdge(sourceId: string, targetId: string, relation: string): Promise<GraphEdge | undefined>;
  upsertEdge(edge: GraphEdge): Promise<void>;
  /** Delete a single edge by id (used when its last supporting source disappears). */
  deleteEdge(id: string): Promise<void>;
  /** All edges incident to any of the given node ids. */
  edgesForNodes(nodeIds: string[]): Promise<GraphEdge[]>;
  /** Every edge in the graph (for export/visualization). */
  allEdges(): Promise<GraphEdge[]>;

  // --- misc ---
  documentTitle(documentId: string): Promise<string>;
  stats(): Promise<GraphStats>;
  close(): Promise<void>;
}
