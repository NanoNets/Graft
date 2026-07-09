import type { Extraction } from "../graph/types.js";
import type { GraphStore } from "../graph/store.js";
import type { Summarizer } from "./summarize.js";

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

  /** OpenRouter key for extraction. Env: OPENROUTER_API_KEY. */
  openrouterApiKey?: string;
  /** Extraction model (an OpenRouter model id). Env: CONTEXT_GRAPH_OPENROUTER_MODEL. Default: openai/gpt-4o-mini */
  openrouterModel?: string;
  /** OpenRouter API base URL. Env: OPENROUTER_BASE_URL. Default: https://openrouter.ai/api/v1 */
  openrouterBaseUrl?: string;

  /**
   * OpenAI key for embeddings (optional — OpenRouter has no embeddings endpoint,
   * so embeddings run locally unless this is set). Env: OPENAI_API_KEY.
   */
  openaiApiKey?: string;
  /** Embedding model. Env: CONTEXT_GRAPH_EMBEDDING_MODEL. Default: text-embedding-3-small */
  embeddingModel?: string;

  /**
   * Force the fully-local providers (in-process embeddings + Ollama extraction)
   * even when an OpenRouter/OpenAI key is present. Env: CONTEXT_GRAPH_LOCAL=1.
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

  /**
   * When a changed file is re-ingested, prune the observations contributed by
   * its now-superseded prior version: facts that survived into the new version
   * are re-observed and stay, while facts that disappeared decay out (and orphan
   * nodes/edges are removed). This is what keeps the graph fresh instead of
   * accumulating stale facts forever. Env: CONTEXT_GRAPH_PRUNE (set to 0 to
   * disable). Default: true.
   */
  pruneSuperseded?: boolean;

  // --- advanced: bring your own components ---
  /** Override the storage backend (defaults to a SQLite store at dbPath). */
  store?: GraphStore;
  /** Override the embedder (defaults to local, or OpenAI when a key is set). */
  embedder?: Embedder;
  /** Override the extractor (defaults to OpenRouter, or local Ollama with no key). */
  extractor?: Extractor;
  /** Override the code summarizer used by repo ingestion (same fallbacks as extractor). */
  summarizer?: Summarizer;
}

/** Fully-resolved configuration with all defaults applied. */
export interface ResolvedConfig {
  dbPath: string;
  openrouterApiKey?: string;
  openrouterModel: string;
  openrouterBaseUrl: string;
  openaiApiKey?: string;
  embeddingModel: string;
  forceLocal: boolean;
  localEmbeddingModel: string;
  ollamaModel: string;
  ollamaBaseUrl: string;
  chunkSize: number;
  chunkOverlap: number;
  mergeThreshold: number;
  pruneSuperseded: boolean;
  store?: GraphStore;
  embedder?: Embedder;
  extractor?: Extractor;
  summarizer?: Summarizer;
}

export const DEFAULTS = {
  dbPath: "./.context-graph/graph.db",
  openrouterModel: "openai/gpt-4o-mini",
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
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
    openrouterApiKey: config.openrouterApiKey ?? env.OPENROUTER_API_KEY,
    openrouterModel:
      config.openrouterModel ??
      env.CONTEXT_GRAPH_OPENROUTER_MODEL ??
      DEFAULTS.openrouterModel,
    openrouterBaseUrl:
      config.openrouterBaseUrl ?? env.OPENROUTER_BASE_URL ?? DEFAULTS.openrouterBaseUrl,
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
    pruneSuperseded:
      config.pruneSuperseded ??
      !["0", "false", "no"].includes((env.CONTEXT_GRAPH_PRUNE ?? "").toLowerCase()),
    store: config.store,
    embedder: config.embedder,
    extractor: config.extractor,
    summarizer: config.summarizer,
  };
}
