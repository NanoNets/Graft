import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { extractPdfText, isPdfPath } from "./ingest/pdf.js";
import { buildGraphExport, type GraphExport } from "./graph/export.js";
import type { GraphStore } from "./graph/store.js";
import { SqliteStore } from "./graph/sqlite-store.js";
import type { Embedder, EngineConfig, Extractor, ResolvedConfig } from "./ai/providers.js";
import { resolveConfig } from "./ai/providers.js";
import { OpenRouterExtractor } from "./ai/openrouter.js";
import { OpenAIEmbedder } from "./ai/openai.js";
import { LocalEmbedder, OllamaExtractor } from "./ai/local.js";
import { OllamaSummarizer, OpenRouterSummarizer, type Summarizer } from "./ai/summarize.js";
import { chunkText } from "./ingest/chunker.js";
import { mergeExtraction } from "./graph/merge.js";
import { serializeGraph, importGraph, type ImportResult } from "./graph/serialize.js";
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

/** Extensions treated as source code by {@link ContextGraphEngine.ingestRepo}. */
export const CODE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".kt", ".scala",
  ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".cc",
  ".cs", ".swift", ".sql", ".sh", ".proto",
];

export interface RepoIngestOptions {
  /** File extensions to treat as code. Default: {@link CODE_EXTENSIONS}. */
  extensions?: string[];
  /** Called before each file summary and each module ingest, for progress UIs. */
  onProgress?: (info: {
    phase: "summarize" | "ingest";
    index: number;
    total: number;
    file: string;
  }) => void;
}

export interface RepoIngestResult {
  /** Code files considered. */
  files: number;
  /** Files freshly summarized with an LLM call this run. */
  summarized: number;
  /** Files whose summary was reused from the content-hash cache. */
  cached: number;
  /** One ingest result per module (top-level directory) document. */
  modules: IngestResult[];
  /** Files that could not be read or summarized (path: reason). */
  errors: string[];
}

/** file path → { content hash, cached summary } */
type RepoSummaryCache = Record<string, { hash: string; summary: string }>;

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
  private _summarizer?: Summarizer;
  private _memRepoCache: RepoSummaryCache = {};

  constructor(config: EngineConfig = {}) {
    this.cfg = resolveConfig(config);
  }

  /** The underlying graph store (lazily opened): an explicit `store` override, or the local SQLite file. */
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
      } else if (!this.cfg.forceLocal && this.cfg.openrouterApiKey) {
        // Use OpenRouter for extraction when a key is available.
        this._extractor = new OpenRouterExtractor(
          this.cfg.openrouterApiKey,
          this.cfg.openrouterModel,
          this.cfg.openrouterBaseUrl,
        );
      } else {
        // Fall back to local extraction via a running Ollama instance.
        this._extractor = new OllamaExtractor(this.cfg.ollamaModel, this.cfg.ollamaBaseUrl);
      }
    }
    return this._extractor;
  }

  private get summarizer(): Summarizer {
    if (!this._summarizer) {
      if (this.cfg.summarizer) {
        this._summarizer = this.cfg.summarizer;
      } else if (!this.cfg.forceLocal && this.cfg.openrouterApiKey) {
        this._summarizer = new OpenRouterSummarizer(
          this.cfg.openrouterApiKey,
          this.cfg.openrouterModel,
          this.cfg.openrouterBaseUrl,
        );
      } else {
        this._summarizer = new OllamaSummarizer(this.cfg.ollamaModel, this.cfg.ollamaBaseUrl);
      }
    }
    return this._summarizer;
  }

  /**
   * Ingest a document from disk. PDFs (`.pdf`) are parsed to text automatically;
   * anything else is read as UTF-8. Title defaults to the file name.
   */
  async ingestFile(path: string, opts: IngestOptions = {}): Promise<IngestResult> {
    const text = isPdfPath(path) ? await extractPdfText(path) : readFileSync(path, "utf8");
    return this.ingest(text, { title: opts.title ?? basename(path), source: opts.source ?? path });
  }

  /** Ingest raw text: chunk it, extract entities/relations, and merge into the graph. */
  async ingest(text: string, opts: IngestOptions = {}): Promise<IngestResult> {
    const now = new Date().toISOString();
    const source = opts.source ?? "inline";
    const title = opts.title ?? source;
    const hash = contentHash(text);

    const existing = await this.store.getDocumentByHash(hash);
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

    // Same source, new content: the file changed, so replace its stale
    // document(s) instead of piling up superseded chunks. "inline" is the
    // catch-all source for pasted text and is exempt — many unrelated
    // documents legitimately share it.
    if (source !== "inline") {
      for (const prior of await this.store.documentsBySource(source)) {
        await this.store.deleteDocument(prior.id);
      }
    }

    const documentId = newId("doc");
    await this.store.insertDocument({ id: documentId, title, source, hash, createdAt: now });

    const pieces = chunkText(text, this.cfg.chunkSize, this.cfg.chunkOverlap);
    const embeddings = await this.embedder.embed(pieces);
    for (let i = 0; i < pieces.length; i++) {
      const chunk: Chunk = {
        id: newId("chunk"),
        documentId,
        ordinal: i,
        text: pieces[i],
        embedding: embeddings[i],
        createdAt: now,
      };
      await this.store.insertChunk(chunk);
    }

    // Extract per chunk (parallel, bounded), then merge sequentially so each
    // merge sees nodes created by earlier chunks. The document id is a unique
    // observation key, so re-importing this document later never double-counts.
    const extractions = await mapWithConcurrency(pieces, 4, (piece) =>
      this.extractor.extract(piece, { hint: title }),
    );

    const provenance = `doc:${documentId}`;
    const totals = { nodesCreated: 0, nodesUpdated: 0, edgesCreated: 0, edgesUpdated: 0 };
    for (const extraction of extractions) {
      const r = await mergeExtraction(
        this.store,
        this.embedder,
        extraction,
        provenance,
        provenance,
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

  /**
   * Ingest every supported document in a directory (recursively). Supported
   * extensions: .pdf, .md, .markdown, .txt. Returns one result per file.
   *
   * `onProgress` is invoked before each file starts (so callers can report
   * progress on long, multi-file ingests — e.g. to keep an MCP client's request
   * timeout from firing).
   */
  async ingestDir(
    dir: string,
    opts: {
      extensions?: string[];
      onProgress?: (info: { index: number; total: number; file: string }) => void;
    } = {},
  ): Promise<IngestResult[]> {
    const exts = opts.extensions ?? [".pdf", ".md", ".markdown", ".txt"];
    const files = walkDir(dir).filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));
    const results: IngestResult[] = [];
    for (let i = 0; i < files.length; i++) {
      opts.onProgress?.({ index: i, total: files.length, file: files[i] });
      results.push(await this.ingestFile(files[i]));
    }
    return results;
  }

  /**
   * Ingest a code repository as **summaries, not raw code**.
   *
   * Raw source is deliberately kept out of the extraction pipeline (LLM entity
   * extraction over code is noisy and expensive; agents already grep code
   * live). Instead each code file gets one LLM-written prose summary; the
   * summaries are grouped into one document per top-level directory and fed
   * through the normal {@link ingest} pipeline.
   *
   * Incremental: summaries are cached by file content hash (in
   * `repo-summaries.json` next to the db), so re-running after edits only
   * re-summarizes changed files, and unchanged module documents are skipped by
   * the ordinary document-hash dedup.
   */
  async ingestRepo(dir: string, opts: RepoIngestOptions = {}): Promise<RepoIngestResult> {
    const root = resolve(dir);
    const exts = opts.extensions ?? CODE_EXTENSIONS;
    const files = walkDir(root).filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)));

    const cache = this.loadRepoCache();
    const result: RepoIngestResult = {
      files: files.length,
      summarized: 0,
      cached: 0,
      modules: [],
      errors: [],
    };

    // Phase 1: one summary per file, concurrent, content-hash cached.
    const summaries = await mapWithConcurrency(files, 8, async (file, i) => {
      const rel = relative(root, file);
      opts.onProgress?.({ phase: "summarize", index: i, total: files.length, file: rel });
      let code: string;
      try {
        code = readFileSync(file, "utf8");
      } catch (err) {
        result.errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
      const hash = contentHash(code);
      const hit = cache[file];
      if (hit && hit.hash === hash) {
        result.cached++;
        return { rel, summary: hit.summary };
      }
      try {
        const summary = await this.summarizer.summarize(code, { path: rel });
        if (!summary) return undefined;
        cache[file] = { hash, summary };
        result.summarized++;
        return { rel, summary };
      } catch (err) {
        result.errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    });
    this.saveRepoCache(cache);

    // Phase 2: group summaries into one document per top-level directory and
    // run them through the normal ingest pipeline. The stable `repo:` source
    // makes re-ingestion replace a module's stale document when it changed.
    const repoName = basename(root);
    const modules = new Map<string, Array<{ rel: string; summary: string }>>();
    for (const s of summaries) {
      if (!s) continue;
      const module = s.rel.includes(sep) ? s.rel.split(sep)[0] : "(root)";
      (modules.get(module) ?? modules.set(module, []).get(module)!).push(s);
    }

    let i = 0;
    for (const [module, entries] of modules) {
      opts.onProgress?.({ phase: "ingest", index: i++, total: modules.size, file: module });
      const text = [
        `# Code summary: ${repoName}/${module}`,
        ...entries.map((e) => `## ${e.rel}\n\n${e.summary}`),
      ].join("\n\n");
      result.modules.push(
        await this.ingest(text, {
          title: `${repoName}/${module} (code summary)`,
          source: `repo:${root}#${module}`,
        }),
      );
    }
    return result;
  }

  /** Path of the file-summary cache, or undefined for in-memory graphs. */
  private get repoCachePath(): string | undefined {
    if (this.cfg.dbPath === ":memory:") return undefined;
    return join(dirname(this.cfg.dbPath), "repo-summaries.json");
  }

  private loadRepoCache(): RepoSummaryCache {
    const path = this.repoCachePath;
    if (!path) return this._memRepoCache;
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, "utf8")) as RepoSummaryCache;
    } catch {
      return {};
    }
  }

  private saveRepoCache(cache: RepoSummaryCache): void {
    const path = this.repoCachePath;
    if (!path) {
      this._memRepoCache = cache;
      return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2));
  }

  /** Read the graph for a query, returning a structured context bundle. */
  async read(query: string, opts: RetrieveOptions = {}): Promise<ContextBundle> {
    return retrieve(this.store, this.embedder, query, opts);
  }

  /** A serializable snapshot of the whole graph, for export/visualization. */
  async exportGraph(): Promise<GraphExport> {
    return buildGraphExport(this.store);
  }

  /**
   * Default path for the git-committed graph file (Mode A), alongside the db
   * file — e.g. `.context-graph/graph.jsonl` next to `.context-graph/graph.db`.
   * Undefined for an in-memory graph.
   */
  get graphFilePath(): string | undefined {
    if (this.cfg.dbPath === ":memory:") return undefined;
    return join(dirname(this.cfg.dbPath), "graph.jsonl");
  }

  /** Human label for the active embedding model, recorded in exported files. */
  private embeddingModelLabel(): string {
    if (!this.cfg.forceLocal && this.cfg.openaiApiKey) return this.cfg.embeddingModel;
    return this.cfg.localEmbeddingModel;
  }

  /**
   * Serialize the whole graph to a JSONL string for git-native team sync
   * (Mode A). Commit the result; teammates {@link importJsonl} it after a pull.
   */
  async exportJsonl(): Promise<string> {
    return serializeGraph(this.store, {
      embeddingDimensions: this.embedder.dimensions,
      embeddingModel: this.embeddingModelLabel(),
    });
  }

  /**
   * Import a serialized graph (from a teammate's commit) and CRDT-merge it into
   * the local graph. Idempotent — re-importing the same content is a no-op.
   */
  async importJsonl(jsonl: string): Promise<ImportResult> {
    return importGraph(this.store, jsonl, this.embedder.dimensions);
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
    const existing = await this.store.getDocumentByHash(hash);
    if (existing) {
      documentId = existing.id;
    } else {
      documentId = newId("doc");
      await this.store.insertDocument({
        id: documentId,
        title,
        source: opts.source ?? provenance,
        hash,
        createdAt: now,
      });
      const [embedding] = await this.embedder.embed([learning]);
      await this.store.insertChunk({
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
    // `agent:<id>` is the human-facing origin; the (unique) contribution
    // document id is the observation key, so replays stay idempotent.
    const r = await mergeExtraction(
      this.store,
      this.embedder,
      extraction,
      provenance,
      `doc:${documentId}`,
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
  async stats(): Promise<GraphStats> {
    return this.store.stats();
  }

  /** Close the underlying store. */
  async close(): Promise<void> {
    await this._store?.close();
  }
}

/** Directories that are dependency/build output, never knowledge. */
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
]);

/** Files above this size are generated/vendored in practice, not written docs or code. */
const MAX_FILE_BYTES = 1_000_000;

/**
 * Recursively list all files under a directory. Skips dot-directories,
 * dependency/build directories (node_modules, dist, …), and files over 1 MB.
 */
function walkDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkDir(full));
    } else if (entry.isFile()) {
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(full);
    }
  }
  return out;
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
