/**
 * Auto-watch: keep the graph evolving as connected folders change.
 *
 * A {@link GraphWatcher} watches document folders and keeps the graph tracking
 * them without manual re-runs of `ingest-dir`. It is *smart* about change in
 * two ways:
 *
 *  - **Significance gate.** A save that only reformats a file (whitespace,
 *    blank lines, line endings) leaves its normalized content unchanged, so it
 *    is skipped without an LLM call. Only meaningful edits are re-ingested.
 *  - **Pruning on delete.** Deleting a watched file forgets what it taught: its
 *    documents are removed and the observations they contributed are pruned, so
 *    facts that lose their last source decay out of the graph (see
 *    {@link ContextGraphEngine.forgetSource}). Facts still supported elsewhere
 *    survive.
 *
 * Rapid saves are absorbed by a per-file debounce, and files are processed by a
 * single serial worker — each ingest already fans out to concurrent LLM
 * extraction internally, so one document at a time keeps spend predictable.
 * Deletes flow through the same worker, so a delete can never race an in-flight
 * ingest of the same file.
 */
import { watch, type FSWatcher } from "chokidar";
import { readFileSync, type Stats } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type { ContextGraphEngine, IngestResult, PruneResult } from "./engine.js";
import { DOC_EXTENSIONS, isIngestablePath, shouldIgnorePath, walkDir } from "./ingest/fs.js";
import { isPdfPath } from "./ingest/pdf.js";
import { contentHash } from "./util/id.js";

export interface WatchOptions {
  /** Extensions to ingest. Default: {@link DOC_EXTENSIONS}. */
  extensions?: string[];
  /** Quiet time after a file's last event before it is ingested. Default 1500ms. */
  debounceMs?: number;
  /** Catch up on the folder's current contents when it is added. Default true. */
  initialScan?: boolean;
  /** Called for every lifecycle event, for progress UIs and logging. */
  onEvent?: (event: WatchEvent) => void;
}

export type WatchEvent =
  | { type: "watching"; dir: string; files: number }
  | { type: "queued"; file: string; reason: "add" | "change" | "initial" }
  | { type: "ingested"; file: string; result: IngestResult }
  | { type: "deleted"; file: string; pruned?: PruneResult & { documentsRemoved: number } }
  | { type: "error"; file: string; error: string };

/**
 * Watches folders and streams their document changes into an engine.
 *
 * One watcher process per db is the supported mode — concurrent graph writes
 * from multiple processes are safe (WAL) but their merges are not transactional.
 */
export class GraphWatcher {
  private watchers = new Map<string, FSWatcher>();
  private debounces = new Map<string, NodeJS.Timeout>();
  private pending = new Set<string>();
  /** Deleted files awaiting a prune pass, drained by the same serial worker. */
  private pendingDeletes = new Set<string>();
  /** Per-path normalized-content hash of the last ingested version (significance gate). */
  private contentHashes = new Map<string, string>();
  private inFlight?: string;
  private working = false;
  private closed = false;
  private idleResolvers: Array<() => void> = [];

  constructor(
    private engine: ContextGraphEngine,
    private opts: WatchOptions = {},
  ) {}

  private get extensions(): string[] {
    return this.opts.extensions ?? DOC_EXTENSIONS;
  }

  private get debounceMs(): number {
    return this.opts.debounceMs ?? 1500;
  }

  private emit(event: WatchEvent): void {
    this.opts.onEvent?.(event);
  }

  /** Watch a folder. Resolves once watching is established (and the initial catch-up scan is queued). */
  async add(dir: string): Promise<void> {
    const root = resolve(dir);
    if (this.watchers.has(root)) return;

    const watcher = watch(root, {
      ignored: (path: string, stats?: Stats) => shouldIgnorePath(path, root, stats),
      ignoreInitial: true,
      // Don't ingest a file mid-write: wait for its size to hold still, so a
      // large PDF that takes a moment to save arrives whole.
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    this.watchers.set(root, watcher);

    const onFile = (reason: "add" | "change") => (path: string) => {
      if (this.closed || !isIngestablePath(path, root, this.extensions)) return;
      this.debounce(path, reason);
    };
    watcher.on("add", onFile("add"));
    watcher.on("change", onFile("change"));
    watcher.on("unlink", (path: string) => {
      if (this.closed) return;
      // Only files we would have ingested are worth forgetting. (unlink has no
      // stats to hand shouldIgnorePath, so match on extension + ignore rules.)
      if (!this.extensions.some((e) => path.toLowerCase().endsWith(e))) return;
      if (shouldIgnorePath(path, root)) return;
      // The file is gone: cancel any queued (re-)ingest and queue a prune.
      const timer = this.debounces.get(path);
      if (timer) clearTimeout(timer);
      this.debounces.delete(path);
      this.pending.delete(path);
      this.pendingDeletes.add(path);
      this.kick();
    });
    watcher.on("error", (err) => {
      this.emit({ type: "error", file: root, error: err instanceof Error ? err.message : String(err) });
    });

    await new Promise<void>((res, rej) => {
      watcher.once("ready", res);
      watcher.once("error", rej);
    });

    let files = 0;
    if (this.opts.initialScan !== false) {
      for (const file of walkDir(root)) {
        if (!isIngestablePath(file, root, this.extensions)) continue;
        files++;
        this.pending.add(file);
        this.emit({ type: "queued", file, reason: "initial" });
      }
      this.kick();
    }
    this.emit({ type: "watching", dir: root, files });
  }

  /** Stop watching a folder and drop its queued (not in-flight) files. */
  async remove(dir: string): Promise<void> {
    const root = resolve(dir);
    const watcher = this.watchers.get(root);
    if (!watcher) return;
    this.watchers.delete(root);
    await watcher.close();
    const under = (path: string) => path === root || path.startsWith(root + sep);
    for (const [path, timer] of this.debounces) {
      if (under(path)) {
        clearTimeout(timer);
        this.debounces.delete(path);
      }
    }
    for (const path of this.pending) {
      if (under(path)) this.pending.delete(path);
    }
    for (const path of this.pendingDeletes) {
      if (under(path)) this.pendingDeletes.delete(path);
    }
    this.checkIdle();
  }

  /** Folders currently being watched. */
  dirs(): string[] {
    return [...this.watchers.keys()];
  }

  /** Files queued (ingest or delete) or being processed right now. */
  pendingCount(): number {
    return (
      this.pending.size +
      this.pendingDeletes.size +
      this.debounces.size +
      (this.inFlight ? 1 : 0)
    );
  }

  /** Resolves once every queued and debouncing file has been ingested. */
  idle(): Promise<void> {
    if (this.pendingCount() === 0) return Promise.resolve();
    return new Promise((res) => this.idleResolvers.push(res));
  }

  /** Stop watching everything, drop queued work, and wait out the in-flight ingest. */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.all([...this.watchers.values()].map((w) => w.close()));
    this.watchers.clear();
    for (const timer of this.debounces.values()) clearTimeout(timer);
    this.debounces.clear();
    this.pending.clear();
    this.pendingDeletes.clear();
    await this.idle();
  }

  private debounce(path: string, reason: "add" | "change"): void {
    const existing = this.debounces.get(path);
    if (existing) clearTimeout(existing);
    else this.emit({ type: "queued", file: path, reason });
    this.debounces.set(
      path,
      setTimeout(() => {
        this.debounces.delete(path);
        if (this.closed) return this.checkIdle();
        // A fresh add/change wins over a pending delete for the same path
        // (e.g. an editor's delete-then-rename save).
        this.pendingDeletes.delete(path);
        this.pending.add(path);
        this.kick();
      }, this.debounceMs),
    );
  }

  private checkIdle(): void {
    if (this.pendingCount() > 0) return;
    const resolvers = this.idleResolvers;
    this.idleResolvers = [];
    for (const res of resolvers) res();
  }

  private kick(): void {
    if (this.working) return;
    this.working = true;
    void this.work().finally(() => {
      this.working = false;
      this.checkIdle();
    });
  }

  private async work(): Promise<void> {
    for (;;) {
      // Drain deletes ahead of ingests so a removed file's knowledge is
      // forgotten promptly, before we spend effort re-reading anything.
      const del = this.takeNextDelete();
      if (del) {
        this.inFlight = del;
        try {
          const pruned = await this.engine.forgetSource(del);
          this.contentHashes.delete(del);
          this.emit({ type: "deleted", file: del, pruned });
        } catch (err) {
          this.emit({ type: "error", file: del, error: err instanceof Error ? err.message : String(err) });
        } finally {
          this.inFlight = undefined;
        }
        continue;
      }

      const next = this.takeNext();
      if (!next) break;
      this.inFlight = next;
      try {
        const result = await this.ingestWithSignificance(next);
        this.emit({ type: "ingested", file: next, result });
      } catch (err) {
        // The file vanished between the event and the ingest — that's a delete.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          const pruned = await this.engine.forgetSource(next).catch(() => undefined);
          this.contentHashes.delete(next);
          this.emit({ type: "deleted", file: next, pruned });
        } else {
          this.emit({ type: "error", file: next, error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        this.inFlight = undefined;
      }
    }
  }

  /**
   * Ingest a file, skipping the LLM pass when the change is insignificant.
   *
   * For text files we compare the *normalized* content (whitespace/line-ending
   * collapsed) against the last version ingested in this session; an unchanged
   * normalization means the save only reformatted the file, so we report it as
   * skipped without re-extracting. Meaningful edits go through the normal ingest
   * path (which itself dedups on exact content and prunes superseded facts).
   * PDFs skip the gate — extracting their text to hash it costs as much as
   * ingesting — and rely on the engine's exact-content dedup.
   */
  private async ingestWithSignificance(path: string): Promise<IngestResult> {
    if (isPdfPath(path)) return this.engine.ingestFile(path);

    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      // Let the normal path surface the real error (or ENOENT → delete).
      return this.engine.ingestFile(path);
    }

    const nhash = contentHash(normalizeForSignificance(text));
    if (this.contentHashes.get(path) === nhash) {
      return {
        documentId: "",
        title: basename(path),
        skipped: true,
        chunks: 0,
        nodesCreated: 0,
        nodesUpdated: 0,
        edgesCreated: 0,
        edgesUpdated: 0,
      };
    }

    const result = await this.engine.ingest(text, { title: basename(path), source: path });
    this.contentHashes.set(path, nhash);
    return result;
  }

  private takeNext(): string | undefined {
    const next = this.pending.values().next().value as string | undefined;
    if (next !== undefined) this.pending.delete(next);
    return next;
  }

  private takeNextDelete(): string | undefined {
    const next = this.pendingDeletes.values().next().value as string | undefined;
    if (next !== undefined) this.pendingDeletes.delete(next);
    return next;
  }
}

/**
 * Collapse formatting-only differences so a reformat hashes identically to the
 * original: normalize line endings, strip trailing whitespace, collapse runs of
 * blank lines and inner whitespace, and trim. Deliberately conservative — it
 * only ignores layout, never content.
 */
function normalizeForSignificance(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}
