import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { GraphStore } from "./store.js";
import type {
  Chunk,
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphStats,
} from "./types.js";
import { normalizeName } from "../util/id.js";

interface NodeRow {
  id: string;
  name: string;
  norm_name: string;
  type: string;
  summary: string;
  aliases: string;
  confidence: number;
  observations: number;
  embedding: string | null;
  provenance: string;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  description: string;
  confidence: number;
  observations: number;
  provenance: string;
  created_at: string;
  updated_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  ordinal: number;
  text: string;
  embedding: string | null;
  created_at: string;
}

/** File-backed graph store using SQLite via better-sqlite3. */
export class SqliteStore implements GraphStore {
  private db: Database.Database;

  /** @param path Path to the .db file, or ":memory:" for an ephemeral graph. */
  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        source     TEXT NOT NULL,
        hash       TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id          TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        ordinal     INTEGER NOT NULL,
        text        TEXT NOT NULL,
        embedding   TEXT,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS nodes (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        norm_name    TEXT NOT NULL,
        type         TEXT NOT NULL,
        summary      TEXT NOT NULL,
        aliases      TEXT NOT NULL DEFAULT '[]',
        confidence   REAL NOT NULL DEFAULT 0.5,
        observations INTEGER NOT NULL DEFAULT 1,
        embedding    TEXT,
        provenance   TEXT NOT NULL DEFAULT '[]',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_norm_name ON nodes(norm_name);

      CREATE TABLE IF NOT EXISTS edges (
        id           TEXT PRIMARY KEY,
        source_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_id    TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        relation     TEXT NOT NULL,
        description  TEXT NOT NULL DEFAULT '',
        confidence   REAL NOT NULL DEFAULT 0.5,
        observations INTEGER NOT NULL DEFAULT 1,
        provenance   TEXT NOT NULL DEFAULT '[]',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        UNIQUE(source_id, target_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    `);
  }

  // --- documents ---

  getDocumentByHash(hash: string): GraphDocument | undefined {
    const row = this.db
      .prepare(`SELECT * FROM documents WHERE hash = ?`)
      .get(hash) as (GraphDocument & { created_at: string }) | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      source: row.source,
      hash: row.hash,
      createdAt: (row as unknown as { created_at: string }).created_at,
    };
  }

  insertDocument(doc: GraphDocument): void {
    this.db
      .prepare(
        `INSERT INTO documents (id, title, source, hash, created_at)
         VALUES (@id, @title, @source, @hash, @createdAt)`,
      )
      .run(doc);
  }

  documentTitle(documentId: string): string {
    const row = this.db
      .prepare(`SELECT title FROM documents WHERE id = ?`)
      .get(documentId) as { title: string } | undefined;
    return row?.title ?? "unknown";
  }

  // --- chunks ---

  insertChunk(chunk: Chunk): void {
    this.db
      .prepare(
        `INSERT INTO chunks (id, document_id, ordinal, text, embedding, created_at)
         VALUES (@id, @documentId, @ordinal, @text, @embedding, @createdAt)`,
      )
      .run({
        ...chunk,
        embedding: chunk.embedding ? JSON.stringify(chunk.embedding) : null,
      });
  }

  getChunksByIds(ids: string[]): Chunk[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as ChunkRow[];
    return rows.map(this.rowToChunk);
  }

  allEmbeddedChunks(): Chunk[] {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE embedding IS NOT NULL`)
      .all() as ChunkRow[];
    return rows.map(this.rowToChunk);
  }

  private rowToChunk(row: ChunkRow): Chunk {
    return {
      id: row.id,
      documentId: row.document_id,
      ordinal: row.ordinal,
      text: row.text,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      createdAt: row.created_at,
    };
  }

  // --- nodes ---

  getNodeById(id: string): GraphNode | undefined {
    const row = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as
      | NodeRow
      | undefined;
    return row ? this.rowToNode(row) : undefined;
  }

  getNodesByIds(ids: string[]): GraphNode[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
      .all(...ids) as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  findNodesByName(normalizedName: string): GraphNode[] {
    // Match either the canonical normalized name or any alias. Aliases are
    // stored normalized in a JSON array, so we match the quoted element form
    // (e.g. `"oauth"`) to avoid partial-substring false positives.
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes
         WHERE norm_name = ?
            OR aliases LIKE ?`,
      )
      .all(normalizedName, `%${JSON.stringify(normalizedName)}%`) as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  allEmbeddedNodes(): GraphNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE embedding IS NOT NULL`)
      .all() as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  allNodes(): GraphNode[] {
    const rows = this.db.prepare(`SELECT * FROM nodes`).all() as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  upsertNode(node: GraphNode): void {
    this.db
      .prepare(
        `INSERT INTO nodes
           (id, name, norm_name, type, summary, aliases, confidence,
            observations, embedding, provenance, created_at, updated_at)
         VALUES
           (@id, @name, @norm_name, @type, @summary, @aliases, @confidence,
            @observations, @embedding, @provenance, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           norm_name = excluded.norm_name,
           type = excluded.type,
           summary = excluded.summary,
           aliases = excluded.aliases,
           confidence = excluded.confidence,
           observations = excluded.observations,
           embedding = excluded.embedding,
           provenance = excluded.provenance,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: node.id,
        name: node.name,
        norm_name: normalizeName(node.name),
        type: node.type,
        summary: node.summary,
        aliases: JSON.stringify(node.aliases),
        confidence: node.confidence,
        observations: node.observations,
        embedding: node.embedding ? JSON.stringify(node.embedding) : null,
        provenance: JSON.stringify(node.provenance),
        created_at: node.createdAt,
        updated_at: node.updatedAt,
      });
  }

  private rowToNode(row: NodeRow): GraphNode {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      summary: row.summary,
      aliases: JSON.parse(row.aliases),
      confidence: row.confidence,
      observations: row.observations,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      provenance: JSON.parse(row.provenance),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- edges ---

  findEdge(sourceId: string, targetId: string, relation: string): GraphEdge | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?`,
      )
      .get(sourceId, targetId, relation) as EdgeRow | undefined;
    return row ? this.rowToEdge(row) : undefined;
  }

  upsertEdge(edge: GraphEdge): void {
    this.db
      .prepare(
        `INSERT INTO edges
           (id, source_id, target_id, relation, description, confidence,
            observations, provenance, created_at, updated_at)
         VALUES
           (@id, @source_id, @target_id, @relation, @description, @confidence,
            @observations, @provenance, @created_at, @updated_at)
         ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
           description = excluded.description,
           confidence = excluded.confidence,
           observations = excluded.observations,
           provenance = excluded.provenance,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        description: edge.description,
        confidence: edge.confidence,
        observations: edge.observations,
        provenance: JSON.stringify(edge.provenance),
        created_at: edge.createdAt,
        updated_at: edge.updatedAt,
      });
  }

  edgesForNodes(nodeIds: string[]): GraphEdge[] {
    if (nodeIds.length === 0) return [];
    const placeholders = nodeIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT * FROM edges
         WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`,
      )
      .all(...nodeIds, ...nodeIds) as EdgeRow[];
    return rows.map((r) => this.rowToEdge(r));
  }

  allEdges(): GraphEdge[] {
    const rows = this.db.prepare(`SELECT * FROM edges`).all() as EdgeRow[];
    return rows.map((r) => this.rowToEdge(r));
  }

  private rowToEdge(row: EdgeRow): GraphEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation,
      description: row.description,
      confidence: row.confidence,
      observations: row.observations,
      provenance: JSON.parse(row.provenance),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- misc ---

  stats(): GraphStats {
    const count = (table: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      documents: count("documents"),
      nodes: count("nodes"),
      edges: count("edges"),
      chunks: count("chunks"),
    };
  }

  close(): void {
    this.db.close();
  }
}
