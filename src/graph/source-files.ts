/**
 * The file set a graph build parses, and its stat metadata.
 *
 * Split out of `build.ts` so the freshness probe (`fingerprint.ts`) can enumerate
 * exactly the same files without importing the builder (which would be an import
 * cycle: build → fingerprint → build). `build.ts` re-exports
 * {@link listSourceFiles} so its existing importers are unaffected.
 */
import { statSync } from "node:fs";
import { relative } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { languageOf } from "./extract.js";

/** The source files a graph build parses: supported languages, minus the output dir. */
export function listSourceFiles(root: string, outDir: string): string[] {
  return walkDir(root).filter((f) => !f.startsWith(outDir) && languageOf(f) !== null);
}

export interface SourceStat {
  /** Absolute path. */
  abs: string;
  /** `relative(root, abs)` — exactly the form `buildGraph` uses for node ids and
   * `checkGraph` diffs against, so cache keys and ids can never disagree. */
  rel: string;
  size: number;
  mtimeMs: number;
}

/**
 * {@link listSourceFiles} plus each file's `(size, mtimeMs)` — the currency of
 * both the freshness probe and the extraction cache. Files that vanish between
 * the walk and the stat are dropped (same fail-soft posture as `walkDir`).
 */
export function listSourceStats(root: string, outDir: string): SourceStat[] {
  const out: SourceStat[] = [];
  for (const abs of listSourceFiles(root, outDir)) {
    let s: { size: number; mtimeMs: number };
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    out.push({ abs, rel: relative(root, abs), size: s.size, mtimeMs: s.mtimeMs });
  }
  return out;
}
