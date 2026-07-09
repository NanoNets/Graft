/**
 * Context Graph Engine — public API.
 *
 * @example
 * ```ts
 * import { ContextGraphEngine } from "context-graph-engine";
 *
 * const engine = new ContextGraphEngine();
 * await engine.ingest(myDocs, { title: "Onboarding" });
 *
 * const ctx = await engine.read("how does auth work?");
 * console.log(ctx.prompt); // inject into your agent
 *
 * await engine.contribute("The auth service rotates tokens every 15 minutes.", {
 *   agentId: "code-reviewer",
 * });
 * ```
 */
export { ContextGraphEngine, CODE_EXTENSIONS } from "./engine.js";
export type {
  IngestOptions,
  IngestResult,
  ContributeOptions,
  ContributeResult,
  PruneResult,
  RepoIngestOptions,
  RepoIngestResult,
  WatchedDir,
} from "./engine.js";

export { DOC_EXTENSIONS } from "./ingest/fs.js";
export { GraphWatcher } from "./watch.js";
export type { WatchOptions, WatchEvent } from "./watch.js";

export type {
  EngineConfig,
  ResolvedConfig,
  Embedder,
  Extractor,
} from "./ai/providers.js";
export { resolveConfig, DEFAULTS } from "./ai/providers.js";

export type { RetrieveOptions } from "./retrieval/retriever.js";
export { retrieve, renderPrompt } from "./retrieval/retriever.js";

export type { GraphStore } from "./graph/store.js";
export { SqliteStore } from "./graph/sqlite-store.js";
export { mergeExtraction, mergeNodeRecords, mergeEdgeRecords } from "./graph/merge.js";
export {
  confidenceFromObservations,
  mergeObservationCounters,
  totalObservations,
} from "./graph/crdt.js";
export { serializeGraph, importGraph, GRAPH_FILE_FORMAT } from "./graph/serialize.js";
export type { ImportResult, SerializeOptions } from "./graph/serialize.js";
export type { GraphExport } from "./graph/export.js";
export { buildGraphExport, toHtml, toMermaid } from "./graph/export.js";

export type {
  GraphNode,
  GraphEdge,
  GraphDocument,
  Chunk,
  ObservationCounter,
  ContextBundle,
  RetrievedNode,
  RetrievedChunk,
  GraphStats,
  Extraction,
  ExtractedEntity,
  ExtractedRelation,
} from "./graph/types.js";

// Providers, for advanced/custom setups.
export { OpenRouterExtractor } from "./ai/openrouter.js";
export { OpenAIEmbedder } from "./ai/openai.js";
export { LocalEmbedder, OllamaExtractor } from "./ai/local.js";
export { OpenRouterSummarizer, OllamaSummarizer } from "./ai/summarize.js";
export type { Summarizer } from "./ai/summarize.js";
