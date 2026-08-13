/**
 * The file set a graph build parses, and its stat metadata.
 *
 * Split out of `build.ts` so the freshness probe (`fingerprint.ts`) can enumerate
 * exactly the same files without importing the builder (which would be an import
 * cycle: build → fingerprint → build). `build.ts` re-exports
 * {@link listSourceFiles} so its existing importers are unaffected.
 */
import { statSync } from "node:fs";
import { resolve, sep } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { relPosix } from "../util/paths.js";
import { readExtensions, readIncludeDirs } from "../util/state.js";
import { languageOf, depthExtensions } from "./extract.js";
import { genericLangOf, genericExtensions } from "./generic.js";

/** Every extension graft has a parser for (depth + breadth), sorted and de-duped —
 * the authoritative answer to "what does `-e` actually support". */
export function supportedExtensions(): string[] {
  return [...new Set([...depthExtensions(), ...genericExtensions()])].sort();
}

/** Normalize a user-supplied extension: ensure a leading dot, lower-case. */
function normExt(e: string): string {
  const t = e.trim().toLowerCase();
  return t.startsWith(".") ? t : `.${t}`;
}

/**
 * The subset of user-supplied `-e` extensions that no parser claims (depth or breadth).
 * `graft build -e ".vue"` used to accept these silently and index nothing; the CLI warns
 * on whatever this returns so an unsupported extension is never a quiet no-op.
 */
export function unsupportedExtensions(exts: string[]): string[] {
  const supported = new Set(supportedExtensions());
  return exts.filter((e) => !supported.has(normExt(e)));
}

/**
 * The source files a graph build parses: supported languages, minus the
 * output dir. When no pre-enumerated `repoFiles` is passed, the walk reads
 * `root`'s persisted `--include-dir` override (if any) directly from state —
 * so every caller that enumerates through here (the fingerprint probe, the
 * hooks/refresh path, none of which ever see a CLI flag) behaves identically
 * to the `graft build --include-dir` invocation that set it.
 *
 * `extensions` is `graft build -e`. It reaches here because this is the ONE
 * enumeration the wiring graph is built from: applied anywhere else, `-e .ts`
 * narrowed the concept pass while the wiring graph kept indexing every language
 * graft has a grammar for — the flag said "only include these code extensions"
 * and the graph the user actually queries ignored it.
 *
 * When the caller passes none, the repo's PERSISTED `-e` is read from state here,
 * exactly as `--include-dir` is above and for a sharper reason: the freshness probe
 * (`fingerprint.ts`) and the pre-query refresh never see a CLI flag, so an
 * unpersisted narrowing meant every excluded file counted as new on the next query
 * and the refresh rebuilt the graph wide again — `-e` would have lasted until the
 * first `graft ask`. It also makes `graft check` agree with the build that wrote
 * the graph without anyone having to repeat the flag.
 */
export function listSourceFiles(
  root: string,
  outDir: string,
  repoFiles: string[] = walkDir(root, readIncludeDirs(resolve(root))),
  extensions?: string[],
): string[] {
  // Excluding the output dir needs a SEGMENT boundary, not a string prefix: with the
  // default outDir `<root>/graft`, a bare `startsWith` also swallows the sibling
  // `graft-tools/` or `graftlib/`, which then never gets indexed and never says why.
  // This repo already documents the class of bug in `util/paths.ts#pathUnderPrefix`
  // ("a plain startsWith would let 'frontend' match 'frontend-utils'"); it just never
  // reached here. `resolve` too, because a relative `--dir` reaches us verbatim and
  // would otherwise never match the absolute paths the walk produces — making the
  // output directory itself part of the source set.
  const out = resolve(outDir);
  const outPrefix = out + sep;
  // Empty is treated as absent, not as "index nothing": commander hands `[]` for a
  // variadic option that was never given, and a build that silently produced an
  // empty graph would be the worst possible reading of a missing flag.
  const asked = extensions?.length ? extensions : readExtensions(resolve(root));
  const wanted = asked?.length ? asked.map(normExt) : undefined;
  // A file is a source file if a depth-tier grammar (languageOf) OR a breadth-tier
  // grammar (genericLangOf) claims its extension. Both must agree here or `build`
  // and `check` would enumerate different sets.
  return repoFiles.filter(
    (f) =>
      !(f === out || f.startsWith(outPrefix)) &&
      (languageOf(f) !== null || genericLangOf(f) !== null) &&
      // `endsWith`, not `extname`, to match how both registries claim a file.
      (wanted === undefined || wanted.some((e) => f.toLowerCase().endsWith(e))),
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
export function listSourceStats(
  root: string,
  outDir: string,
  repoFiles?: string[],
  extensions?: string[],
): SourceStat[] {
  const out: SourceStat[] = [];
  for (const abs of listSourceFiles(root, outDir, repoFiles, extensions)) {
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
