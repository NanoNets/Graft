/**
 * Auto-watch: keep the graph evolving as connected folders change.
 *
 * A {@link GraphWatcher} watches document folders and re-ingests files as they
 * are added or edited, so the graph tracks the folder without manual re-runs
 * of `ingest-dir`. Deliberately append-only: deleting a file never removes
 * knowledge already learned from it (the grow-only observation model is
 * untouched); the deletion is surfaced as an event and nothing more.
 *
 * Rapid saves are absorbed by a per-file debounce, and files are ingested by a
 * single serial worker — each ingest already fans out to concurrent LLM
 * extraction internally, so one document at a time keeps spend predictable.
 */
import { watch, type FSWatcher } from "chokidar";
import type { Stats } from "node:fs";
import { resolve, sep } from "node:path";
import type { ContextGraphEngine, IngestResult } from "./engine.js";
import { DOC_EXTENSIONS, isIngestablePath, shouldIgnorePath, walkDir } from "./ingest/fs.js";

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
  | { type: "deleted"; file: string }
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
      // Append-only by design: the file is gone but what it taught us stays.
      this.debounces.delete(path);
      this.pending.delete(path);
      this.emit({ type: "deleted", file: path });
      this.checkIdle();
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
    this.checkIdle();
  }

  /** Folders currently being watched. */
  dirs(): string[] {
    return [...this.watchers.keys()];
  }

  /** Files queued or being ingested right now. */
  pendingCount(): number {
    return this.pending.size + this.debounces.size + (this.inFlight ? 1 : 0);
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
    for (let next = this.takeNext(); next; next = this.takeNext()) {
      this.inFlight = next;
      try {
        const result = await this.engine.ingestFile(next);
        this.emit({ type: "ingested", file: next, result });
      } catch (err) {
        // The file vanished between the event and the ingest — that's a delete.
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this.emit({ type: "deleted", file: next });
        } else {
          this.emit({ type: "error", file: next, error: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        this.inFlight = undefined;
      }
    }
  }

  private takeNext(): string | undefined {
    const next = this.pending.values().next().value as string | undefined;
    if (next !== undefined) this.pending.delete(next);
    return next;
  }
}
