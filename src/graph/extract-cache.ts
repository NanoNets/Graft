/**
 * Per-file memo for Tier-1 extraction — `<outDir>/.cache/extract.json`.
 *
 * `extractFile` is pure and file-local (`rel`, `source`, `lang` → `{nodes,
 * rawEdges}`), which is the whole trick: an unchanged file's parse result can be
 * replayed from disk instead of re-running tree-sitter. That turns
 * {@link buildGraph} from "always re-parse the repo" (~4.6ms/file) into "re-parse
 * only what moved", which is what makes a rebuild cheap enough to run *before*
 * every query (see `graph/refresh.ts`).
 *
 * Everything downstream of extraction (edge resolution, enrichment, the graph
 * write, the ask sidecar, cards) still runs over the whole merged node set, so no
 * other invariant changes — an incremental build must produce a byte-identical
 * `wiring.json` to a cold one.
 *
 * Crucially the cached nodes keep `body_text`: `writeGraph` strips it before
 * serializing, so `wiring.json` can never be the reuse source — the ask sidecar
 * needs a body for every node, including the ones we didn't re-parse.
 *
 * Lives under `.cache/` (gitignored, regenerate-anytime) next to `ask-index.json`
 * and `summaries.json`. Two things invalidate the whole file: a bump of
 * {@link CACHE_VERSION}, and a change to the extractor module itself (stamped by
 * its mtime+size, so an npm upgrade or a local rebuild drops stale parses without
 * anyone remembering to bump anything).
 */
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CACHE_DIR } from "../context/node-file.js";
import { readJson, writeJsonAtomic } from "../util/state.js";
import type { RawEdge } from "./extract.js";
import type { NodeV1 } from "./types.js";

/** Bump when the on-disk shape below changes. */
const CACHE_VERSION = 1;
const EXTRACT_CACHE_FILE = "extract.json";

export interface ExtractEntry {
  size: number;
  mtimeMs: number;
  /** sha256 of the file's bytes — the same value as its `kind:"file"` node's `body_hash`. */
  hash: string;
  nodes: NodeV1[];
  rawEdges: RawEdge[];
  /** Set when this file couldn't be read or parsed. The entry exists anyway so the
   * freshness probe doesn't flag the file as new on every query; replaying it
   * re-reports the same error and contributes no nodes, exactly as a cold build
   * would. */
  error?: string;
}

export interface ExtractCache {
  version: number;
  /** Identity of the extractor that produced these entries. */
  extractor: string;
  /** repo-relative source path → its last parse. */
  files: Record<string, ExtractEntry>;
}

export function extractCachePath(outDir: string): string {
  return join(outDir, CACHE_DIR, EXTRACT_CACHE_FILE);
}

/** `mtime:size` of the extractor module, or `"unknown"` when it can't be stat'd.
 * Resolved by rewriting this module's own URL, so it works both in `dist/` (.js)
 * and under tsx (.ts) without knowing which layout we're in. */
function extractorStamp(): string {
  try {
    const url = import.meta.url.replace(/extract-cache\.(c|m)?([jt]s)$/, "extract.$1$2");
    if (url === import.meta.url) return "unknown";
    const s = statSync(fileURLToPath(url));
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "unknown";
  }
}

export function emptyExtractCache(): ExtractCache {
  return { version: CACHE_VERSION, extractor: extractorStamp(), files: {} };
}

/** The cache for `outDir`, or an empty one when it's absent, unparseable, or was
 * written by a different cache version / extractor build. */
export function readExtractCache(outDir: string): ExtractCache {
  const c = readJson<ExtractCache>(extractCachePath(outDir));
  const stamp = extractorStamp();
  if (!c || c.version !== CACHE_VERSION || c.extractor !== stamp || typeof c.files !== "object") {
    return emptyExtractCache();
  }
  return { version: c.version, extractor: c.extractor, files: c.files ?? {} };
}

/** Best-effort write — a full graph is already on disk by the time this runs, so
 * an unwritable cache dir must never fail the build (it only costs the next
 * build its reuse). Returns false when the write failed. */
export function writeExtractCache(outDir: string, cache: ExtractCache): boolean {
  try {
    writeJsonAtomic(extractCachePath(outDir), cache, true);
    return true;
  } catch {
    return false;
  }
}
