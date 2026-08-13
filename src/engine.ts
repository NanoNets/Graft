/**
 * The Context Graph Engine.
 *
 * Two operations, no database:
 *   - {@link Graft.init}  build `.context/` from a code repo.
 *   - {@link Graft.check} report whether `.context/` is still in
 *     sync with the code (for CI).
 *
 * The graph is a folder of linked markdown files committed to the repo; git is
 * the sync. This class wires the configured LLM provider into the build/check
 * pipelines; an API key is required for any LLM-backed operation.
 */
import { credentialProblem, resolveConfig, type EngineConfig, type ResolvedConfig } from "./ai/providers.js";
import { ChatSynthesizer, type Synthesizer } from "./ai/synthesize.js";
import { ChatSummarizer, type Summarizer } from "./ai/summarize.js";
import { ChatCruxSummarizer, type CruxSummarizer } from "./ai/crux.js";
import { createChatModel } from "./ai/llm/factory.js";
import type { ChatModel } from "./ai/llm/types.js";
import { buildContext, CODE_EXTENSIONS, type BuildProgress, type BuildResult } from "./context/build.js";
import { checkContext, type CheckResult } from "./context/check.js";
import { buildGraph, type GraphBuildOptions, type GraphBuildResult } from "./graph/build.js";
import { checkGraph, type GraphCheckResult } from "./graph/check.js";
import { ask, type AskResult } from "./ask/ask.js";

export { CODE_EXTENSIONS };
export type { BuildResult, BuildProgress, CheckResult, GraphBuildResult, GraphCheckResult, AskResult };

export interface InitOptions {
  /** Code extensions to include. Default: {@link CODE_EXTENSIONS}. */
  extensions?: string[];
  /** Max files summarized in parallel during the concept pass — the library face
   * of `graft build -j`. Without it the flag reached only the wiring graph's
   * Tier-2 pass, so `-j 1` (set to survive a rate limit, or to avoid N
   * simultaneous `claude-cli` processes) still fired 5 concurrent calls through
   * the whole concept phase, which is where a `--deep` build spends most of them. */
  concurrency?: number;
  /** Progress callback for long builds. */
  onProgress?: (info: BuildProgress) => void;
}

export interface CheckRunOptions {
  extensions?: string[];
}

/** Token totals for everything one {@link Graft} instance sent to the model.
 * `input` is uncached input only — the adapters already separate it from
 * `cacheRead`/`cacheCreate`, which are billed at different rates by every
 * provider that has them. */
export interface RunUsage {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

export interface GraphRunOptions {
  /** Run the Tier-2 LLM meaning pass (summary + crux). Absent → Tier-1 only. */
  llm?: boolean;
  /** Narrow the indexed file set to these extensions (`graft build -e`). Pass the
   * same value to {@link Graft.checkGraph} or the check reports the excluded files
   * as drift. */
  extensions?: string[];
  /** Max files summarized in parallel during the LLM pass. */
  concurrency?: number;
  /** Replay unchanged files from the extraction cache (default true). */
  reuse?: boolean;
  /** Opt-in compiler-grade LSP edge enrichment (`graft build --lsp`). */
  lsp?: boolean;
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
      concurrency: opts.concurrency,
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

  /** Report whether the committed `graph.json` is in sync with the code (Tier-1 diff).
   * Async because the breadth tier warms WASM grammars before re-extraction. */
  checkGraph(dir: string, opts: CheckRunOptions = {}): Promise<GraphCheckResult> {
    return checkGraph(dir, { contextDir: this.cfg.contextDir, extensions: opts.extensions });
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
      extensions: opts.extensions,
      concurrency: opts.concurrency,
      reuse: opts.reuse,
      lsp: opts.lsp,
      onProgress: opts.onProgress,
    });
  }

  /**
   * Answer a plain-words query from the committed `graft/` graph — the active
   * channel. Deterministic and $0: routes structural queries to the wiring
   * edges and everything else to a lexical rank over concepts + symbols.
   */
  ask(dir: string, query: string, opts: { limit?: number; source?: boolean; full?: boolean; in?: string; graphRank?: boolean } = {}): AskResult {
    return ask(dir, query, {
      contextDir: this.cfg.contextDir,
      limit: opts.limit,
      source: opts.source,
      full: opts.full,
      in: opts.in,
      graphRank: opts.graphRank,
    });
  }

  private _chatModel?: ChatModel;
  private _usage: RunUsage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

  /**
   * What this engine instance has spent so far, in tokens.
   *
   * Every adapter normalizes `Usage` carefully (uncached input separated from cache
   * reads and cache writes) and every op then dropped it on the floor, so a `--deep`
   * build over a 5000-file repo could not tell you afterwards how many calls it made,
   * let alone what they cost. Counted HERE, by wrapping the transport once, rather
   * than threaded through summarize/synthesize/crux — those three would each have to
   * remember, and a fourth op would silently not count.
   *
   * Tokens, not dollars: prices are per-model, change without notice, and are not
   * knowable at all for `claude-cli` (a subscription) or for whatever gateway sits
   * behind a custom base URL. A wrong number here would be worse than none.
   */
  usage(): RunUsage {
    return { ...this._usage };
  }

  /** The configured transport, or a clear error telling the user how to set a key. */
  private chatModel(): ChatModel {
    if (this._chatModel) return this._chatModel;
    if (this.cfg.chatModel) return (this._chatModel = this.metered(this.cfg.chatModel));
    const problem = credentialProblem(this.cfg);
    if (problem) throw new Error(problem);
    this._chatModel = this.metered(createChatModel({
      provider: this.cfg.provider,
      apiKey: this.cfg.apiKey,
      model: this.cfg.model,
      baseUrl: this.cfg.baseUrl,
      headers: this.cfg.headers,
      bin: this.cfg.bin,
      timeoutMs: this.cfg.timeoutMs,
      maxBudgetUsd: this.cfg.maxBudgetUsd,
      maxRetries: this.cfg.maxRetries,
    }));
    return this._chatModel;
  }

  /** The transport with a token counter around it. A wrapper rather than a
   * subclass, because the thing being wrapped may be a caller's own `chatModel`
   * — an object this engine did not construct and must not change. */
  private metered(inner: ChatModel): ChatModel {
    const totals = this._usage;
    return {
      label: inner.label,
      async create(req) {
        const res = await inner.create(req);
        totals.calls++;
        totals.input += res.usage.input;
        totals.output += res.usage.output;
        totals.cacheRead += res.usage.cacheRead;
        totals.cacheCreate += res.usage.cacheCreate;
        return res;
      },
    };
  }

  private synthesizer(): Synthesizer {
    return this.cfg.synthesizer ?? new ChatSynthesizer(this.chatModel());
  }

  /** Per-node crux summarizer for the code graph's Tier-2 pass. */
  private cruxSummarizer(): CruxSummarizer {
    return this.cfg.cruxSummarizer ?? new ChatCruxSummarizer(this.chatModel());
  }

  private summarizer(): Summarizer {
    return this.cfg.summarizer ?? new ChatSummarizer(this.chatModel());
  }

  /** Human label for the active model, recorded in the manifest. */
  private modelLabel(): string {
    if (this.cfg.chatModel) return this.cfg.chatModel.label;
    if (this.cfg.synthesizer || this.cfg.summarizer || this.cfg.cruxSummarizer) return "custom";
    return `${this.cfg.provider}:${this.cfg.model}`;
  }
}
