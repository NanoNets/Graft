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
 * SQLite backend can be swapped for another store (Postgres/pgvector, an
 * in-memory store, a remote service) without touching engine logic.
 */
export interface GraphStore {
  // --- documents ---
  getDocumentByHash(hash: string): GraphDocument | undefined;
  insertDocument(doc: GraphDocument): void;

  // --- chunks ---
  insertChunk(chunk: Chunk): void;
  getChunksByIds(ids: string[]): Chunk[];
  /** All chunks that have an embedding, for in-memory vector search. */
  allEmbeddedChunks(): Chunk[];

  // --- nodes ---
  getNodeById(id: string): GraphNode | undefined;
  getNodesByIds(ids: string[]): GraphNode[];
  /** Nodes whose canonical name or an alias matches (normalized, exact). */
  findNodesByName(normalizedName: string): GraphNode[];
  /** All nodes that have an embedding, for in-memory vector search & dedup. */
  allEmbeddedNodes(): GraphNode[];
  upsertNode(node: GraphNode): void;

  // --- edges ---
  /** Existing edge with the same (source, target, relation), if any. */
  findEdge(sourceId: string, targetId: string, relation: string): GraphEdge | undefined;
  upsertEdge(edge: GraphEdge): void;
  /** All edges incident to any of the given node ids. */
  edgesForNodes(nodeIds: string[]): GraphEdge[];

  // --- misc ---
  documentTitle(documentId: string): string;
  stats(): GraphStats;
  close(): void;
}
