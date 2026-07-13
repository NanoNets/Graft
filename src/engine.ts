/**
 * The Context Graph Engine.
 *
 * Two operations, no database:
 *   - {@link ContextGraphEngine.init}  build `.context/` from a code repo.
 *   - {@link ContextGraphEngine.check} report whether `.context/` is still in
 *     sync with the code (for CI).
 *
 * The graph is a folder of linked markdown files committed to the repo; git is
 * the sync. This class only wires the configured LLM providers (local Ollama by
 * default, OpenRouter when a key is present) into the build/check pipelines.
 */
import { resolveConfig, type EngineConfig, type ResolvedConfig } from "./ai/providers.js";
import { OpenRouterSynthesizer, OllamaSynthesizer, type Synthesizer } from "./ai/synthesize.js";
import { OpenRouterSummarizer, OllamaSummarizer, type Summarizer } from "./ai/summarize.js";
import { buildContext, CODE_EXTENSIONS, type BuildProgress, type BuildResult } from "./context/build.js";
import { checkContext, type CheckResult } from "./context/check.js";

export { CODE_EXTENSIONS };
export type { BuildResult, BuildProgress, CheckResult };

export interface InitOptions {
  /** Code extensions to include. Default: {@link CODE_EXTENSIONS}. */
  extensions?: string[];
  /** Progress callback for long builds. */
  onProgress?: (info: BuildProgress) => void;
}

export interface CheckRunOptions {
  extensions?: string[];
}

export class ContextGraphEngine {
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

  /** Report whether the committed graph is still in sync with the code. */
  check(dir: string, opts: CheckRunOptions = {}): CheckResult {
    return checkContext(dir, { contextDir: this.cfg.contextDir, extensions: opts.extensions });
  }

  private synthesizer(): Synthesizer {
    if (this.cfg.synthesizer) return this.cfg.synthesizer;
    if (!this.cfg.forceLocal && this.cfg.openrouterApiKey) {
      return new OpenRouterSynthesizer(
        this.cfg.openrouterApiKey,
        this.cfg.openrouterModel,
        this.cfg.openrouterBaseUrl,
      );
    }
    return new OllamaSynthesizer(this.cfg.ollamaModel, this.cfg.ollamaBaseUrl);
  }

  private summarizer(): Summarizer {
    if (this.cfg.summarizer) return this.cfg.summarizer;
    if (!this.cfg.forceLocal && this.cfg.openrouterApiKey) {
      return new OpenRouterSummarizer(
        this.cfg.openrouterApiKey,
        this.cfg.openrouterModel,
        this.cfg.openrouterBaseUrl,
      );
    }
    return new OllamaSummarizer(this.cfg.ollamaModel, this.cfg.ollamaBaseUrl);
  }

  /** Human label for the active model, recorded in the manifest. */
  private modelLabel(): string {
    if (this.cfg.synthesizer || this.cfg.summarizer) return "custom";
    if (!this.cfg.forceLocal && this.cfg.openrouterApiKey) return `openrouter:${this.cfg.openrouterModel}`;
    return `ollama:${this.cfg.ollamaModel}`;
  }
}
