/**
 * The cheap "has the working tree moved?" probe that gates the pre-query rebuild.
 *
 * Every graft retrieval call runs this, so it has to be ~free on the common
 * unchanged path: a walk + one `stat` per source file, no reads, no parsing.
 * Measured at ~3ms for 280 files. Only files whose `(size, mtimeMs)` disagree
 * with the last build's record get read and hashed, which is what keeps a `touch`
 * or a `git checkout` of identical bytes from triggering a pointless rebuild.
 *
 * Note graft has no notion of git here (it never shells out to git, never reads
 * `.git`): drift is measured against the bytes in the working tree, so an
 * uncommitted, staged, or committed edit all look the same — which is the point.
 *
 * `<outDir>/.cache/fingerprint.json` is a projection of the extraction cache
 * (`extract-cache.ts`) minus the parse results, written by the same build. Keeping
 * it separate means the probe reads ~10KB instead of the multi-MB parse cache. The
 * two can only ever disagree by one sidecar going missing, and both directions
 * degrade safely: no fingerprint → "unknown, rebuild"; no parse cache → the
 * rebuild is just cold.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "../context/node-file.js";
import { contentHash } from "../util/id.js";
import { readJson, writeJsonAtomic } from "../util/state.js";
import { extractorStamp, pruneSidecars, type ExtractEntry } from "./extract-cache.js";
import { listSourceStats } from "./source-files.js";

const FINGERPRINT_PREFIX = "fingerprint";
const FINGERPRINT_VERSION = 1;

/** The identity this graft's prints are filed under. Unlike the extract memo, a
 * missing extractor identity is *not* disqualifying here: freshness is a claim about
 * source bytes, and a build with no memo is merely cold, never wrong. So stamp what
 * we can and fall back to a shared bucket. */
function stamp(): string {
  return extractorStamp() ?? "nostamp";
}

/** `[size, mtimeMs, hash]` — positional to keep the file small. */
type Print = [number, number, string];

export interface Fingerprint {
  version: number;
  /** The extractor that produced the graph these prints describe — the same stamp
   * `extract.json` carries. Without it the two sidecars can disagree about whether
   * the graph is current: an extractor change correctly drops every memo entry,
   * yet the prints still match the tree byte-for-byte, so the probe would report
   * clean and queries would keep answering from nodes the old extractor built. */
  extractor: string;
  files: Record<string, Print>;
}

/** What moved since the last build. Empty in all three arrays = nothing to do. */
export interface Drift {
  /** Recorded files whose bytes differ now. */
  changed: string[];
  /** Source files with no record — new, or never indexed. */
  added: string[];
  /** Recorded files that are gone from disk. */
  removed: string[];
}

/** `<outDir>/.cache/fingerprint.<stamp>.json` — keyed by extractor identity for the
 * same reason the memo is (see {@link extractCachePath}): two grafts on one repo,
 * typically an `npx` MCP server and a locally installed hook binary, must not keep
 * invalidating each other's prints and forcing a cold rebuild on every call. */
export function fingerprintPath(outDir: string): string {
  return join(outDir, CACHE_DIR, `${FINGERPRINT_PREFIX}.${stamp()}.json`);
}

export function readFingerprint(outDir: string): Fingerprint | null {
  const f = readJson<Fingerprint>(fingerprintPath(outDir));
  if (!f || f.version !== FINGERPRINT_VERSION || typeof f.files !== "object" || !f.files) return null;
  if (f.extractor !== stamp()) return null; // different extractor — re-extract, don't trust these prints
  return f;
}

/** Project the extraction cache's entries into the probe sidecar. Best-effort:
 * the graph is already on disk when this runs, so a failed write costs the next
 * probe its fast path and nothing more. */
export function writeFingerprint(outDir: string, entries: Record<string, ExtractEntry>): boolean {
  const files: Record<string, Print> = {};
  for (const [rel, e] of Object.entries(entries)) files[rel] = [e.size, e.mtimeMs, e.hash];
  try {
    writeJsonAtomic(fingerprintPath(outDir), { version: FINGERPRINT_VERSION, extractor: stamp(), files }, true);
    pruneSidecars(join(outDir, CACHE_DIR), FINGERPRINT_PREFIX);
    return true;
  } catch {
    return false;
  }
}

/** `GRAFT_REFRESH=hash` — never trust a stat, confirm every file by its bytes. */
export function alwaysHash(): boolean {
  return process.env.GRAFT_REFRESH === "hash";
}

/**
 * May a recorded `(size, mtimeMs, hash)` be trusted for the file `f` as it is on
 * disk now, without reading it?
 *
 * **One definition, shared by the probe and the builder.** They each had their own
 * once, and the two disagreed in both directions: `GRAFT_REFRESH=hash` was honored
 * here but not in `build.ts` (so the probe reported drift the rebuild then refused
 * to repair — a rebuild on every query, forever, still answering from pre-edit
 * code), and `build.ts` distrusted entries from a failed read while the probe
 * fast-pathed them (so a `chmod +r` that fixed a file was never noticed, because a
 * chmod changes neither size nor mtime). Any future rule about what a stat can be
 * trusted for belongs here and nowhere else.
 *
 * An empty `hash` means the last build never got the bytes — always re-read.
 * A *parse* failure keeps its real hash, so it stays on the fast path: re-reading
 * bytes that failed to parse yesterday just fails to parse again.
 */
export function statUnchanged(
  rec: { size: number; mtimeMs: number; hash: string },
  f: { size: number; mtimeMs: number },
): boolean {
  if (alwaysHash()) return false;
  if (!rec.hash) return false;
  return rec.size === f.size && rec.mtimeMs === f.mtimeMs;
}

export function isClean(d: Drift): boolean {
  return d.changed.length === 0 && d.added.length === 0 && d.removed.length === 0;
}

export function driftCount(d: Drift): number {
  return d.changed.length + d.added.length + d.removed.length;
}

/**
 * Diff the working tree against the last build's fingerprint. Returns null when
 * there is no fingerprint to compare against (never built, or built by a version
 * that didn't write one) — callers should treat that as "unknown", not "clean".
 *
 * `GRAFT_REFRESH=hash` skips the stat fast path and hashes every file, for the
 * rare tooling that rewrites content while preserving size and mtime.
 */
export function probeDrift(root: string, outDir: string): Drift | null {
  const fp = readFingerprint(outDir);
  if (!fp) return null;

  const drift: Drift = { changed: [], added: [], removed: [] };
  const seen = new Set<string>();

  for (const f of listSourceStats(root, outDir)) {
    seen.add(f.rel);
    const print = fp.files[f.rel];
    if (!print) {
      drift.added.push(f.rel);
      continue;
    }
    const [size, mtimeMs, hash] = print;
    if (statUnchanged({ size, mtimeMs, hash }, f)) continue;
    // Suspect: confirm by bytes, so a touch (or a checkout that restores the
    // same content) doesn't cost a rebuild. An entry with an empty hash lands
    // here every time by design — that's a file the last build couldn't read, and
    // the only way to learn it's readable again is to try.
    let now: string;
    try {
      now = contentHash(readFileSync(f.abs, "utf8"));
    } catch {
      continue; // unreadable right now — leave it to the next probe
    }
    if (now !== hash) drift.changed.push(f.rel);
  }

  for (const rel of Object.keys(fp.files)) {
    if (!seen.has(rel)) drift.removed.push(rel);
  }

  drift.changed.sort();
  drift.added.sort();
  drift.removed.sort();
  return drift;
}
