/**
 * The file set a graph build parses, and its stat metadata.
 *
 * Split out of `build.ts` so the freshness probe (`fingerprint.ts`) can enumerate
 * exactly the same files without importing the builder (which would be an import
 * cycle: build → fingerprint → build). `build.ts` re-exports
 * {@link listSourceFiles} so its existing importers are unaffected.
 */
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { relPosix } from "../util/paths.js";
import { readIncludeDirs } from "../util/state.js";
import { languageOf } from "./extract.js";

/**
 * The source files a graph build parses: supported languages, minus the
 * output dir. When no pre-enumerated `repoFiles` is passed, the walk reads
 * `root`'s persisted `--include-dir` override (if any) directly from state —
 * so every caller that enumerates through here (the fingerprint probe, the
 * hooks/refresh path, none of which ever see a CLI flag) behaves identically
 * to the `graft build --include-dir` invocation that set it.
 */
export function listSourceFiles(
  root: string,
  outDir: string,
  repoFiles: string[] = walkDir(root, readIncludeDirs(resolve(root))),
): string[] {
  return repoFiles.filter((f) => !f.startsWith(outDir) && languageOf(f) !== null);
}

export interface SourceStat {
  /** Absolute path. */
  abs: string;
  /** Repo-relative, posix (`relPosix`) — exactly the form `buildGraph` uses for
   * node ids and `checkGraph` diffs against, so cache keys and ids can never
   * disagree. Posix on every platform: see `../util/paths.ts`. */
  rel: string;
  size: number;
  mtimeMs: number;
}

/**
 * {@link listSourceFiles} plus each file's `(size, mtimeMs)` — the currency of
 * both the freshness probe and the extraction cache. Files that vanish between
 * the walk and the stat are dropped (same fail-soft posture as `walkDir`).
 */
export function listSourceStats(root: string, outDir: string, repoFiles?: string[]): SourceStat[] {
  const out: SourceStat[] = [];
  for (const abs of listSourceFiles(root, outDir, repoFiles)) {
    let s: { size: number; mtimeMs: number };
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    out.push({ abs, rel: relPosix(root, abs), size: s.size, mtimeMs: s.mtimeMs });
  }
  return out;
}
