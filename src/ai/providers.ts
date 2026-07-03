import type { Extraction } from "../graph/types.js";
import type { GraphStore } from "../graph/store.js";

/** Turns text into embedding vectors for semantic search and dedup. */
export interface Embedder {
  /** Vector dimensionality produced by {@link embed}. */
  readonly dimensions: number;
  /** Embed a batch of texts, returning one vector per input (order preserved). */
  embed(texts: string[]): Promise<number[][]>;
}

/** Extracts entities and relationships from a passage of text. */
export interface Extractor {
  extract(text: string, opts?: { hint?: string }): Promise<Extraction>;
}

/**
 * User-facing configuration for the engine. Anything omitted falls back to
 * environment variables and then to sensible defaults.
 */
export interface EngineConfig {
  /** Path to the SQLite graph file. Env: CONTEXT_GRAPH_DB. Default: ./.context-graph/graph.db */
  dbPath?: string;

  /** Anthropic key for extraction. Env: ANTHROPIC_API_KEY. */
  anthropicApiKey?: string;
  /** Extraction model. Env: CONTEXT_GRAPH_EXTRACTION_MODEL. Default: claude-haiku-4-5-20251001 */
  extractionModel?: string;

  /** OpenAI key for embeddings. Env: OPENAI_API_KEY. */
  openaiApiKey?: string;
  /** Embedding model. Env: CONTEXT_GRAPH_EMBEDDING_MODEL. Default: text-embedding-3-small */
  embeddingModel?: string;

  /**
   * Force the fully-local providers (in-process embeddings + Ollama extraction)
   * even when cloud API keys are present. Env: CONTEXT_GRAPH_LOCAL=1.
   */
  forceLocal?: boolean;
  /** Local embedding model (transformers.js). Env: CONTEXT_GRAPH_LOCAL_EMBEDDING_MODEL. Default: Xenova/all-MiniLM-L6-v2 */
  localEmbeddingModel?: string;
  /** Ollama model for local extraction. Env: CONTEXT_GRAPH_OLLAMA_MODEL. Default: llama3.2 */
  ollamaModel?: string;
  /** Ollama base URL. Env: CONTEXT_GRAPH_OLLAMA_URL. Default: http://localhost:11434 */
  ollamaBaseUrl?: string;

  /** Target characters per chunk during ingestion. Default: 1200. */
  chunkSize?: number;
  /** Character overlap between adjacent chunks. Default: 200. */
  chunkOverlap?: number;

  /**
   * Cosine-similarity threshold above which two entities are treated as the
   * same node and merged. Higher = stricter. Default: 0.86.
   */
  mergeThreshold?: number;

  // --- advanced: bring your own components ---
  /** Override the storage backend (defaults to a SQLite store at dbPath). */
  store?: GraphStore;
  /** Override the embedder (defaults to OpenAI). */
  embedder?: Embedder;
  /** Override the extractor (defaults to Claude). */
  extractor?: Extractor;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  dbPath: string;
  anthropicApiKey?: string;
  extractionModel: string;
  openaiApiKey?: string;
  embeddingModel: string;
  forceLocal: boolean;
  localEmbeddingModel: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  mergeThreshold: number;
  store?: GraphStore;
  embedder?: Embedder;
  extractor?: Extractor;
}

export const DEFAULTS = {
  dbPath: "./.context-graph/graph.db",
  extractionModel: "claude-haiku-4-5-20251001",
  embeddingModel: "text-embedding-3-small",
  localEmbeddingModel: "Xenova/all-MiniLM-L6-v2",
  ollamaModel: "llama3.2",
  ollamaBaseUrl: "http://localhost:11434",
  chunkSize: 1200,
  chunkOverlap: 200,
  mergeThreshold: 0.86,
} as const;

/** Merge user config with environment variables and defaults. */
export function resolveConfig(config: EngineConfig = {}): ResolvedConfig {
  const env = process.env;
  return {
    dbPath: config.dbPath ?? env.CONTEXT_GRAPH_DB ?? DEFAULTS.dbPath,
    anthropicApiKey: config.anthropicApiKey ?? env.ANTHROPIC_API_KEY,
    extractionModel:
      config.extractionModel ??
      env.CONTEXT_GRAPH_EXTRACTION_MODEL ??
      DEFAULTS.extractionModel,
    openaiApiKey: config.openaiApiKey ?? env.OPENAI_API_KEY,
    embeddingModel:
      config.embeddingModel ??
      env.CONTEXT_GRAPH_EMBEDDING_MODEL ??
      DEFAULTS.embeddingModel,
    forceLocal:
      config.forceLocal ??
      ["1", "true", "yes"].includes((env.CONTEXT_GRAPH_LOCAL ?? "").toLowerCase()),
    localEmbeddingModel:
      config.localEmbeddingModel ??
      env.CONTEXT_GRAPH_LOCAL_EMBEDDING_MODEL ??
      DEFAULTS.localEmbeddingModel,
    ollamaModel:
      config.ollamaModel ?? env.CONTEXT_GRAPH_OLLAMA_MODEL ?? DEFAULTS.ollamaModel,
    ollamaBaseUrl:
      config.ollamaBaseUrl ?? env.CONTEXT_GRAPH_OLLAMA_URL ?? DEFAULTS.ollamaBaseUrl,
    chunkSize: config.chunkSize ?? DEFAULTS.chunkSize,
    chunkOverlap: config.chunkOverlap ?? DEFAULTS.chunkOverlap,
    mergeThreshold: config.mergeThreshold ?? DEFAULTS.mergeThreshold,
    store: config.store,
    embedder: config.embedder,
    extractor: config.extractor,
  };
}
