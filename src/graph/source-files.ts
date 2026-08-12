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
import { readFollowSubmodules, readIncludeDirs } from "../util/state.js";
import { languageOf } from "./extract.js";
import { genericLangOf } from "./generic.js";

/**
 * The source files a graph build parses: supported languages, minus the
 * output dir. When no pre-enumerated `repoFiles` is passed, the walk reads
 * `root`'s persisted file-walk choices directly from state, so every caller
 * that enumerates through here (the fingerprint probe and hooks/refresh path,
 * none of which ever see a CLI flag) behaves identically to the build that
 * saved those choices.
 */
export function listSourceFiles(
  root: string,
  outDir: string,
  repoFiles: string[] = walkDir(root, readIncludeDirs(resolve(root)), {
    followSubmodules: readFollowSubmodules(resolve(root)),
  }),
): string[] {
  // A file is a source file if a depth-tier grammar (languageOf) OR a breadth-tier
  // grammar (genericLangOf) claims its extension. Both must agree here or `build`
  // and `check` would enumerate different sets.
  return repoFiles.filter(
    (f) => !f.startsWith(outDir) && (languageOf(f) !== null || genericLangOf(f) !== null),
  );
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
