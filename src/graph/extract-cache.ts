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
 * {@link CACHE_VERSION} for a change of on-disk shape, and a change to the
 * extraction code itself, caught by content-hashing it — see
 * {@link extractorStamp}. Neither asks anyone to remember to bump anything.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, extname, join } from "node:path";
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

/** Computed once per process — this can't change under a running process without
 * the module graph itself being swapped, and a long-lived MCP server holding the
 * identity of the code it actually loaded is the correct answer anyway. */
let memoizedStamp: string | null = null;

/**
 * Identity of the code that produces the cached parses. Both sidecars key on it,
 * so *anything* that can change extraction output has to change this string.
 *
 * Content-hashed over every sibling module in this directory, plus the package
 * version. Two earlier instincts are deliberately rejected:
 *
 * - **Not a timestamp.** This was `mtime:size` of `extract.js` alone, which is
 *   wrong in both directions. Too loose: the parse of `db.count()` depends on
 *   `bindings.ts` deciding that `db` is a `UserRepo` (that answer is stored *in*
 *   the cached entry, as an edge's `recvType`), and fixing a binding bug leaves
 *   `extract.js`'s emitted bytes untouched — so any build that skips rewriting
 *   unchanged output keeps the old stamp and silently replays pre-fix edges. Too
 *   tight: a rebuild that rewrites identical content moves the mtime and throws
 *   away the whole memo for nothing.
 * - **Not a hand-kept list of modules.** A list is correct exactly until someone
 *   moves parse logic into a module nobody added to it, and the failure is silent.
 *
 * Hashing the directory over-invalidates a little — editing any `graph/` module
 * costs one cold rebuild — which is no more often than a version bump already
 * costs, and always in the safe direction. The package version is folded in so a
 * tree-sitter grammar upgrade (which changes parse output without changing any of
 * graft's own files) invalidates too.
 *
 * Measured at ~0.5ms for 21 files / 556KB, paid once per process.
 */
export function extractorStamp(): string {
  if (memoizedStamp === null) memoizedStamp = computeStamp();
  return memoizedStamp;
}

function computeStamp(): string {
  try {
    const self = fileURLToPath(import.meta.url);
    // `.js` when running from `dist/`, `.ts` under tsx — take the extension from
    // our own filename rather than guessing which layout we're in.
    const dir = dirname(self);
    return stampDir(dir, extname(self), packageVersion(dir));
  } catch {
    return "unknown";
  }
}

/**
 * Hash every `ext` file in `dir`, plus `version`. Separated from
 * {@link extractorStamp} so a test can prove the property that matters: a change
 * to *any* module in the directory moves the stamp, not just the one the old
 * implementation happened to watch.
 */
export function stampDir(dir: string, ext: string, version = ""): string {
  const files = readdirSync(dir).filter((f) => f.endsWith(ext)).sort();
  if (!files.length) return "unknown";
  const h = createHash("sha256");
  h.update(version);
  for (const f of files) {
    h.update(f); // a rename is a change, even at identical content
    h.update(readFileSync(join(dir, f)));
  }
  return h.digest("hex").slice(0, 16);
}

/** graft's own version, or `""` when it can't be read (then the content hash
 * alone carries the stamp — still correct for every local edit). */
function packageVersion(graphDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(graphDir, "..", "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "";
  } catch {
    return "";
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
