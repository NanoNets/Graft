import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { GraphStore } from "./graph/store.js";
import { SqliteStore } from "./graph/sqlite-store.js";
import type { Embedder, EngineConfig, Extractor, ResolvedConfig } from "./ai/providers.js";
import { resolveConfig } from "./ai/providers.js";
import { AnthropicExtractor } from "./ai/anthropic.js";
import { OpenAIEmbedder } from "./ai/openai.js";
import { LocalEmbedder, OllamaExtractor } from "./ai/local.js";
import { chunkText } from "./ingest/chunker.js";
import { mergeExtraction } from "./graph/merge.js";
import { retrieve, type RetrieveOptions } from "./retrieval/retriever.js";
import type { ContextBundle, Chunk, Extraction, GraphStats } from "./graph/types.js";
import { contentHash, newId } from "./util/id.js";

export interface IngestOptions {
  /** Human-readable title for the document. Default: derived from source. */
  title?: string;
  /** Where the content came from (path, URL, label). Default: "inline". */
  source?: string;
}

export interface IngestResult {
  documentId: string;
  title: string;
  /** True if the document was already present (identical hash) and was skipped. */
  skipped: boolean;
  chunks: number;
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesUpdated: number;
}

export interface ContributeOptions {
  /** Identifier of the agent contributing the learning. Default: "agent". */
  agentId?: string;
  /** Optional label for where the learning came from (task id, session, …). */
  source?: string;
}

export interface ContributeResult {
  documentId: string;
  nodesCreated: number;
  nodesUpdated: number;
  edgesCreated: number;
  edgesUpdated: number;
}

/**
 * The Context Graph Engine.
 *
 * Turn documents into a structured knowledge graph ({@link ingest}), let agents
 * read relevant context before doing work ({@link read}), and let them
 * contribute learnings back so the graph improves over time ({@link contribute}).
 */
export class ContextGraphEngine {
  private cfg: ResolvedConfig;
  private _store?: GraphStore;
  private _embedder?: Embedder;
  private _extractor?: Extractor;

  constructor(config: EngineConfig = {}) {
    this.cfg = resolveConfig(config);
  }

  /** The underlying graph store (lazily opened). */
  get store(): GraphStore {
    if (!this._store) {
      this._store = this.cfg.store ?? new SqliteStore(this.cfg.dbPath);
    }
    return this._store;
  }

  private get embedder(): Embedder {
    if (!this._embedder) {
      if (this.cfg.embedder) {
        // Explicit override wins.
        this._embedder = this.cfg.embedder;
      } else if (!this.cfg.forceLocal && this.cfg.openaiApiKey) {
        // Use cloud embeddings when a key is available.
        this._embedder = new OpenAIEmbedder(this.cfg.openaiApiKey, this.cfg.embeddingModel);
      } else {
        // Fall back to fully-local, in-process embeddings (no key required).
        this._embedder = new LocalEmbedder(this.cfg.localEmbeddingModel);
      }
    }
    return this._embedder;
  }

  private get extractor(): Extractor {
    if (!this._extractor) {
      if (this.cfg.extractor) {
        // Explicit override wins.
        this._extractor = this.cfg.extractor;
      } else if (!this.cfg.forceLocal && this.cfg.anthropicApiKey) {
        // Use cloud extraction when a key is available.
        this._extractor = new AnthropicExtractor(
          this.cfg.anthropicApiKey,
          this.cfg.extractionModel,
        );
      } else {
        // Fall back to local extraction via a running Ollama instance.
        this._extractor = new OllamaExtractor(this.cfg.ollamaModel, this.cfg.ollamaBaseUrl);
      }
    }
    return this._extractor;
  }

  /** Ingest a document from disk. Title defaults to the file name. */
  async ingestFile(path: string, opts: IngestOptions = {}): Promise<IngestResult> {
    const text = readFileSync(path, "utf8");
    return this.ingest(text, { title: opts.title ?? basename(path), source: opts.source ?? path });
  }

  /** Ingest raw text: chunk it, extract entities/relations, and merge into the graph. */
  async ingest(text: string, opts: IngestOptions = {}): Promise<IngestResult> {
    const now = new Date().toISOString();
    const source = opts.source ?? "inline";
    const title = opts.title ?? source;
    const hash = contentHash(text);

    const existing = this.store.getDocumentByHash(hash);
    if (existing) {
      return {
        documentId: existing.id,
        title: existing.title,
        skipped: true,
        chunks: 0,
        nodesCreated: 0,
        nodesUpdated: 0,
        edgesCreated: 0,
        edgesUpdated: 0,
      };
    }

    const documentId = newId("doc");
    this.store.insertDocument({ id: documentId, title, source, hash, createdAt: now });

    const pieces = chunkText(text, this.cfg.chunkSize, this.cfg.chunkOverlap);
    const embeddings = await this.embedder.embed(pieces);
    pieces.forEach((piece, i) => {
      const chunk: Chunk = {
        id: newId("chunk"),
        documentId,
        ordinal: i,
        text: piece,
        embedding: embeddings[i],
        createdAt: now,
      };
      this.store.insertChunk(chunk);
    });

    // Extract per chunk (parallel, bounded), then merge sequentially so each
    // merge sees nodes created by earlier chunks.
    const extractions = await mapWithConcurrency(pieces, 4, (piece) =>
      this.extractor.extract(piece, { hint: title }),
    );

    const totals = { nodesCreated: 0, nodesUpdated: 0, edgesCreated: 0, edgesUpdated: 0 };
    for (const extraction of extractions) {
      const r = await mergeExtraction(
        this.store,
        this.embedder,
        extraction,
        `doc:${documentId}`,
        this.cfg.mergeThreshold,
        now,
      );
      totals.nodesCreated += r.nodesCreated;
      totals.nodesUpdated += r.nodesUpdated;
      totals.edgesCreated += r.edgesCreated;
      totals.edgesUpdated += r.edgesUpdated;
    }

    return { documentId, title, skipped: false, chunks: pieces.length, ...totals };
  }

  /** Read the graph for a query, returning a structured context bundle. */
  async read(query: string, opts: RetrieveOptions = {}): Promise<ContextBundle> {
    return retrieve(this.store, this.embedder, query, opts);
  }

  /**
   * Contribute a learning discovered by an agent. The text is stored as
   * retrievable evidence and its entities/relations are merged into the graph,
   * reinforcing what is already known and adding what is new.
   */
  async contribute(learning: string, opts: ContributeOptions = {}): Promise<ContributeResult> {
    const now = new Date().toISOString();
    const agentId = opts.agentId ?? "agent";
    const provenance = `agent:${agentId}`;
    const title = `Learning from ${agentId}: ${learning.slice(0, 60)}${learning.length > 60 ? "…" : ""}`;
    const hash = contentHash(`${provenance}|${learning}`);

    let documentId: string;
    const existing = this.store.getDocumentByHash(hash);
    if (existing) {
      documentId = existing.id;
    } else {
      documentId = newId("doc");
      this.store.insertDocument({
        id: documentId,
        title,
        source: opts.source ?? provenance,
        hash,
        createdAt: now,
      });
      const [embedding] = await this.embedder.embed([learning]);
      this.store.insertChunk({
        id: newId("chunk"),
        documentId,
        ordinal: 0,
        text: learning,
        embedding,
        createdAt: now,
      });
    }

    const extraction: Extraction = await this.extractor.extract(learning, {
      hint: "An agent's learning to fold into the shared knowledge graph.",
    });
    const r = await mergeExtraction(
      this.store,
      this.embedder,
      extraction,
      provenance,
      this.cfg.mergeThreshold,
      now,
    );

    return {
      documentId,
      nodesCreated: r.nodesCreated,
      nodesUpdated: r.nodesUpdated,
      edgesCreated: r.edgesCreated,
      edgesUpdated: r.edgesUpdated,
    };
  }

  /** Current graph statistics. */
  stats(): GraphStats {
    return this.store.stats();
  }

  /** Close the underlying store. */
  close(): void {
    this._store?.close();
  }
}

/** Run `fn` over `items` with at most `limit` in flight at once, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
