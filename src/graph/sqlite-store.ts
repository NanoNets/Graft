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
  ObservationCounter,
} from "./types.js";
import { normalizeName } from "../util/id.js";
import { totalObservations } from "./crdt.js";

interface NodeRow {
  id: string;
  name: string;
  norm_name: string;
  type: string;
  summary: string;
  summary_updated_at: string | null;
  aliases: string;
  confidence: number;
  observations: number;
  observation_sources: string | null;
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
  description_updated_at: string | null;
  confidence: number;
  observations: number;
  observation_sources: string | null;
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

/**
 * File-backed graph store using SQLite via better-sqlite3.
 *
 * better-sqlite3 is synchronous; the async {@link GraphStore} methods here just
 * wrap those synchronous calls and resolve immediately, so the local path stays
 * as fast as before while conforming to the interface a networked store needs.
 */
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
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        norm_name           TEXT NOT NULL,
        type                TEXT NOT NULL,
        summary             TEXT NOT NULL,
        summary_updated_at  TEXT,
        aliases             TEXT NOT NULL DEFAULT '[]',
        confidence          REAL NOT NULL DEFAULT 0.5,
        observations        INTEGER NOT NULL DEFAULT 1,
        observation_sources TEXT NOT NULL DEFAULT '{}',
        embedding           TEXT,
        provenance          TEXT NOT NULL DEFAULT '[]',
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_norm_name ON nodes(norm_name);

      CREATE TABLE IF NOT EXISTS edges (
        id                    TEXT PRIMARY KEY,
        source_id             TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        target_id             TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
        relation              TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        description_updated_at TEXT,
        confidence            REAL NOT NULL DEFAULT 0.5,
        observations          INTEGER NOT NULL DEFAULT 1,
        observation_sources   TEXT NOT NULL DEFAULT '{}',
        provenance            TEXT NOT NULL DEFAULT '[]',
        created_at            TEXT NOT NULL,
        updated_at            TEXT NOT NULL,
        UNIQUE(source_id, target_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
    `);
    // Additive migrations for graphs created before the CRDT columns existed.
    this.addColumnIfMissing("nodes", "summary_updated_at", "TEXT");
    this.addColumnIfMissing("nodes", "observation_sources", "TEXT NOT NULL DEFAULT '{}'");
    this.addColumnIfMissing("edges", "description_updated_at", "TEXT");
    this.addColumnIfMissing("edges", "observation_sources", "TEXT NOT NULL DEFAULT '{}'");
  }

  private addColumnIfMissing(table: string, column: string, ddl: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  // --- documents ---

  async getDocumentByHash(hash: string): Promise<GraphDocument | undefined> {
    const row = this.db.prepare(`SELECT * FROM documents WHERE hash = ?`).get(hash) as
      | (GraphDocument & { created_at: string })
      | undefined;
    return row ? this.rowToDocument(row as unknown as Record<string, unknown>) : undefined;
  }

  async getDocumentById(id: string): Promise<GraphDocument | undefined> {
    const row = this.db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToDocument(row) : undefined;
  }

  async documentsBySource(source: string): Promise<GraphDocument[]> {
    const rows = this.db
      .prepare(`SELECT * FROM documents WHERE source = ? ORDER BY created_at DESC`)
      .all(source) as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDocument(r));
  }

  async deleteDocument(id: string): Promise<void> {
    // Chunks cascade via the document_id foreign key.
    this.db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
  }

  async insertDocument(doc: GraphDocument): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO documents (id, title, source, hash, created_at)
         VALUES (@id, @title, @source, @hash, @createdAt)`,
      )
      .run(doc);
  }

  async allDocuments(): Promise<GraphDocument[]> {
    const rows = this.db
      .prepare(`SELECT * FROM documents ORDER BY created_at DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => this.rowToDocument(r));
  }

  private rowToDocument(r: Record<string, unknown>): GraphDocument {
    return {
      id: r.id as string,
      title: r.title as string,
      source: r.source as string,
      hash: r.hash as string,
      createdAt: r.created_at as string,
    };
  }

  async documentTitle(documentId: string): Promise<string> {
    const row = this.db
      .prepare(`SELECT title FROM documents WHERE id = ?`)
      .get(documentId) as { title: string } | undefined;
    return row?.title ?? "unknown";
  }

  // --- chunks ---

  async insertChunk(chunk: Chunk): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO chunks (id, document_id, ordinal, text, embedding, created_at)
         VALUES (@id, @documentId, @ordinal, @text, @embedding, @createdAt)`,
      )
      .run({
        ...chunk,
        embedding: chunk.embedding ? JSON.stringify(chunk.embedding) : null,
      });
  }

  async getChunksByIds(ids: string[]): Promise<Chunk[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`)
      .all(...ids) as ChunkRow[];
    return rows.map(this.rowToChunk);
  }

  async allEmbeddedChunks(): Promise<Chunk[]> {
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE embedding IS NOT NULL`)
      .all() as ChunkRow[];
    return rows.map(this.rowToChunk);
  }

  async allChunks(): Promise<Chunk[]> {
    const rows = this.db.prepare(`SELECT * FROM chunks`).all() as ChunkRow[];
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

  async getNodeById(id: string): Promise<GraphNode | undefined> {
    const row = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id) as
      | NodeRow
      | undefined;
    return row ? this.rowToNode(row) : undefined;
  }

  async getNodesByIds(ids: string[]): Promise<GraphNode[]> {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`)
      .all(...ids) as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  async findNodesByName(normalizedName: string): Promise<GraphNode[]> {
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

  async allEmbeddedNodes(): Promise<GraphNode[]> {
    const rows = this.db
      .prepare(`SELECT * FROM nodes WHERE embedding IS NOT NULL`)
      .all() as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  async allNodes(): Promise<GraphNode[]> {
    const rows = this.db.prepare(`SELECT * FROM nodes`).all() as NodeRow[];
    return rows.map((r) => this.rowToNode(r));
  }

  async upsertNode(node: GraphNode): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO nodes
           (id, name, norm_name, type, summary, summary_updated_at, aliases, confidence,
            observations, observation_sources, embedding, provenance, created_at, updated_at)
         VALUES
           (@id, @name, @norm_name, @type, @summary, @summary_updated_at, @aliases, @confidence,
            @observations, @observation_sources, @embedding, @provenance, @created_at, @updated_at)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           norm_name = excluded.norm_name,
           type = excluded.type,
           summary = excluded.summary,
           summary_updated_at = excluded.summary_updated_at,
           aliases = excluded.aliases,
           confidence = excluded.confidence,
           observations = excluded.observations,
           observation_sources = excluded.observation_sources,
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
        summary_updated_at: node.summaryUpdatedAt,
        aliases: JSON.stringify(node.aliases),
        confidence: node.confidence,
        observations: node.observations,
        observation_sources: JSON.stringify(node.observationSources),
        embedding: node.embedding ? JSON.stringify(node.embedding) : null,
        provenance: JSON.stringify(node.provenance),
        created_at: node.createdAt,
        updated_at: node.updatedAt,
      });
  }

  async deleteNode(id: string): Promise<void> {
    // Incident edges cascade via the source_id/target_id foreign keys
    // (foreign_keys = ON, set in the constructor).
    this.db.prepare(`DELETE FROM nodes WHERE id = ?`).run(id);
  }

  private rowToNode(row: NodeRow): GraphNode {
    const observationSources = parseCounter(row.observation_sources, row.observations);
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      summary: row.summary,
      summaryUpdatedAt: row.summary_updated_at ?? row.updated_at,
      aliases: JSON.parse(row.aliases),
      confidence: row.confidence,
      observations: totalObservations(observationSources),
      observationSources,
      embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
      provenance: JSON.parse(row.provenance),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- edges ---

  async findEdge(
    sourceId: string,
    targetId: string,
    relation: string,
  ): Promise<GraphEdge | undefined> {
    const row = this.db
      .prepare(
        `SELECT * FROM edges WHERE source_id = ? AND target_id = ? AND relation = ?`,
      )
      .get(sourceId, targetId, relation) as EdgeRow | undefined;
    return row ? this.rowToEdge(row) : undefined;
  }

  async upsertEdge(edge: GraphEdge): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO edges
           (id, source_id, target_id, relation, description, description_updated_at, confidence,
            observations, observation_sources, provenance, created_at, updated_at)
         VALUES
           (@id, @source_id, @target_id, @relation, @description, @description_updated_at, @confidence,
            @observations, @observation_sources, @provenance, @created_at, @updated_at)
         ON CONFLICT(source_id, target_id, relation) DO UPDATE SET
           description = excluded.description,
           description_updated_at = excluded.description_updated_at,
           confidence = excluded.confidence,
           observations = excluded.observations,
           observation_sources = excluded.observation_sources,
           provenance = excluded.provenance,
           updated_at = excluded.updated_at`,
      )
      .run({
        id: edge.id,
        source_id: edge.sourceId,
        target_id: edge.targetId,
        relation: edge.relation,
        description: edge.description,
        description_updated_at: edge.descriptionUpdatedAt,
        confidence: edge.confidence,
        observations: edge.observations,
        observation_sources: JSON.stringify(edge.observationSources),
        provenance: JSON.stringify(edge.provenance),
        created_at: edge.createdAt,
        updated_at: edge.updatedAt,
      });
  }

  async deleteEdge(id: string): Promise<void> {
    this.db.prepare(`DELETE FROM edges WHERE id = ?`).run(id);
  }

  async edgesForNodes(nodeIds: string[]): Promise<GraphEdge[]> {
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

  async allEdges(): Promise<GraphEdge[]> {
    const rows = this.db.prepare(`SELECT * FROM edges`).all() as EdgeRow[];
    return rows.map((r) => this.rowToEdge(r));
  }

  private rowToEdge(row: EdgeRow): GraphEdge {
    const observationSources = parseCounter(row.observation_sources, row.observations);
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation,
      description: row.description,
      descriptionUpdatedAt: row.description_updated_at ?? row.updated_at,
      confidence: row.confidence,
      observations: totalObservations(observationSources),
      observationSources,
      provenance: JSON.parse(row.provenance),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --- misc ---

  async stats(): Promise<GraphStats> {
    const count = (table: string): number =>
      (this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    return {
      documents: count("documents"),
      nodes: count("nodes"),
      edges: count("edges"),
      chunks: count("chunks"),
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/**
 * Parse a stored observation counter. Graphs created before the CRDT columns
 * existed have an empty counter but a real scalar `observations`; seed a single
 * "legacy" bucket so their totals survive the migration.
 */
function parseCounter(raw: string | null, legacyObservations: number): ObservationCounter {
  const parsed = raw ? (JSON.parse(raw) as ObservationCounter) : {};
  if (Object.keys(parsed).length === 0 && legacyObservations > 0) {
    return { legacy: legacyObservations };
  }
  return parsed;
}
