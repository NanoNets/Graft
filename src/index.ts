/**
 * Context Graph Engine — public API.
 *
 * The graph is a folder of linked markdown files (`.context/`) committed to the
 * repo. Build it from code, then check it stays in sync.
 *
 * @example
 * ```ts
 * import { ContextGraphEngine } from "context-graph-engine";
 *
 * const engine = new ContextGraphEngine();
 * await engine.init(".");             // writes .context/*.md + manifest.json
 *
 * const result = engine.check(".");   // { ok: boolean, ...drift }
 * if (!result.ok) process.exitCode = 1;
 * ```
 */
export { ContextGraphEngine, CODE_EXTENSIONS } from "./engine.js";
export type { InitOptions, CheckRunOptions, BuildResult, BuildProgress, CheckResult } from "./engine.js";

export { buildContext } from "./context/build.js";
export type { BuildOptions } from "./context/build.js";
export { checkContext, formatCheckReport } from "./context/check.js";
export type { CheckOptions } from "./context/check.js";
export type { ContextNode, NodeLink, SourceRef, Manifest } from "./context/node-file.js";

export type { EngineConfig, ResolvedConfig } from "./ai/providers.js";
export { resolveConfig, DEFAULTS } from "./ai/providers.js";

// Providers, for advanced/custom setups.
export { OpenRouterSynthesizer, OllamaSynthesizer } from "./ai/synthesize.js";
export type { Synthesizer, SynthNode, SynthLink, FileSummary } from "./ai/synthesize.js";
export { OpenRouterSummarizer, OllamaSummarizer } from "./ai/summarize.js";
export type { Summarizer } from "./ai/summarize.js";
