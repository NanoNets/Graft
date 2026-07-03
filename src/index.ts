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
export { ContextGraphEngine } from "./engine.js";
export type {
  IngestOptions,
  IngestResult,
  ContributeOptions,
  ContributeResult,
} from "./engine.js";

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
export { mergeExtraction } from "./graph/merge.js";

export type {
  GraphNode,
  GraphEdge,
  GraphDocument,
  Chunk,
  ContextBundle,
  RetrievedNode,
  RetrievedChunk,
  GraphStats,
  Extraction,
  ExtractedEntity,
  ExtractedRelation,
} from "./graph/types.js";

// Providers, for advanced/custom setups.
export { AnthropicExtractor } from "./ai/anthropic.js";
export { OpenAIEmbedder } from "./ai/openai.js";
export { LocalEmbedder, OllamaExtractor } from "./ai/local.js";
