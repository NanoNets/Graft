/**
 * The Context Graph Engine.
 *
 * Two operations, no database:
 *   - {@link Graft.init}  build `.context/` from a code repo.
 *   - {@link Graft.check} report whether `.context/` is still in
 *     sync with the code (for CI).
 *
 * The graph is a folder of linked markdown files committed to the repo; git is
 * the sync. This class wires the OpenRouter LLM providers into the build/check
 * pipelines; an API key is required for any LLM-backed operation.
 */
import { resolveConfig, type EngineConfig, type ResolvedConfig } from "./ai/providers.js";
import { OpenRouterSynthesizer, type Synthesizer } from "./ai/synthesize.js";
import { OpenRouterSummarizer, type Summarizer } from "./ai/summarize.js";
import { OpenRouterCruxSummarizer, type CruxSummarizer } from "./ai/crux.js";
import { buildContext, CODE_EXTENSIONS, type BuildProgress, type BuildResult } from "./context/build.js";
import { checkContext, type CheckResult } from "./context/check.js";
import { buildGraph, type GraphBuildOptions, type GraphBuildResult } from "./graph/build.js";
import { checkGraph, type GraphCheckResult } from "./graph/check.js";

export { CODE_EXTENSIONS };
export type { BuildResult, BuildProgress, CheckResult, GraphBuildResult, GraphCheckResult };

export interface InitOptions {
  /** Code extensions to include. Default: {@link CODE_EXTENSIONS}. */
  extensions?: string[];
  /** Progress callback for long builds. */
  onProgress?: (info: BuildProgress) => void;
}

export interface CheckRunOptions {
  extensions?: string[];
}

export interface GraphRunOptions {
  /** Run the Tier-2 LLM meaning pass (summary + crux). Absent → Tier-1 only. */
  llm?: boolean;
  onProgress?: GraphBuildOptions["onProgress"];
}

export class Graft {
  private cfg: ResolvedConfig;

  constructor(config: EngineConfig = {}) {
    this.cfg = resolveConfig(config);
  }

  /** Build the `.context/` graph from the repo at `dir`. */
  async init(dir: string, opts: InitOptions = {}): Promise<BuildResult> {
    return buildContext(dir, {
      contextDir: this.cfg.contextDir,
      extensions: opts.extensions,
      model: this.modelLabel(),
      summarizer: this.summarizer(),
      synthesizer: this.synthesizer(),
      onProgress: opts.onProgress,
    });
  }

  /** Report whether the committed `.context/` markdown graph is in sync with the code. */
  check(dir: string, opts: CheckRunOptions = {}): CheckResult {
    return checkContext(dir, { contextDir: this.cfg.contextDir, extensions: opts.extensions });
  }

  /** Report whether the committed `graph.json` is in sync with the code (Tier-1 diff). */
  checkGraph(dir: string): GraphCheckResult {
    return checkGraph(dir, { contextDir: this.cfg.contextDir });
  }

  /**
   * Build `.context/graph.json` — a per-symbol code graph from tree-sitter.
   * Tier-1 (structure) always runs; the Tier-2 meaning layer runs only when
   * `opts.llm` is set. Either way the prior meaning layer is preserved.
   */
  graph(dir: string, opts: GraphRunOptions = {}): Promise<GraphBuildResult> {
    return buildGraph(dir, {
      contextDir: this.cfg.contextDir,
      summarizer: opts.llm ? this.cruxSummarizer() : undefined,
      onProgress: opts.onProgress,
    });
  }

  /** The OpenRouter API key, or a clear error telling the user how to set it. */
  private requireKey(): string {
    if (!this.cfg.openrouterApiKey) {
      throw new Error(
        "No OpenRouter API key. Set OPENROUTER_API_KEY (get one at https://openrouter.ai/keys) " +
          "to build or summarize the graph.",
      );
    }
    return this.cfg.openrouterApiKey;
  }

  private synthesizer(): Synthesizer {
    if (this.cfg.synthesizer) return this.cfg.synthesizer;
    return new OpenRouterSynthesizer(this.requireKey(), this.cfg.openrouterModel, this.cfg.openrouterBaseUrl);
  }

  /** Per-node crux summarizer for the code graph's Tier-2 pass. */
  private cruxSummarizer(): CruxSummarizer {
    return new OpenRouterCruxSummarizer(this.requireKey(), this.cfg.openrouterModel, this.cfg.openrouterBaseUrl);
  }

  private summarizer(): Summarizer {
    if (this.cfg.summarizer) return this.cfg.summarizer;
    return new OpenRouterSummarizer(this.requireKey(), this.cfg.openrouterModel, this.cfg.openrouterBaseUrl);
  }

  /** Human label for the active model, recorded in the manifest. */
  private modelLabel(): string {
    if (this.cfg.synthesizer || this.cfg.summarizer) return "custom";
    return `openrouter:${this.cfg.openrouterModel}`;
  }
}
