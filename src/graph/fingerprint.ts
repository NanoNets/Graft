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
import type { ExtractEntry } from "./extract-cache.js";
import { listSourceStats } from "./source-files.js";

const FINGERPRINT_FILE = "fingerprint.json";
const FINGERPRINT_VERSION = 1;

/** `[size, mtimeMs, hash]` — positional to keep the file small. */
type Print = [number, number, string];

export interface Fingerprint {
  version: number;
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

export function fingerprintPath(outDir: string): string {
  return join(outDir, CACHE_DIR, FINGERPRINT_FILE);
}

export function readFingerprint(outDir: string): Fingerprint | null {
  const f = readJson<Fingerprint>(fingerprintPath(outDir));
  if (!f || f.version !== FINGERPRINT_VERSION || typeof f.files !== "object" || !f.files) return null;
  return f;
}

/** Project the extraction cache's entries into the probe sidecar. Best-effort:
 * the graph is already on disk when this runs, so a failed write costs the next
 * probe its fast path and nothing more. */
export function writeFingerprint(outDir: string, entries: Record<string, ExtractEntry>): boolean {
  const files: Record<string, Print> = {};
  for (const [rel, e] of Object.entries(entries)) files[rel] = [e.size, e.mtimeMs, e.hash];
  try {
    writeJsonAtomic(fingerprintPath(outDir), { version: FINGERPRINT_VERSION, files }, true);
    return true;
  } catch {
    return false;
  }
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
  const alwaysHash = process.env.GRAFT_REFRESH === "hash";

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
    if (!alwaysHash && size === f.size && mtimeMs === f.mtimeMs) continue;
    // Suspect: confirm by bytes, so a touch (or a checkout that restores the
    // same content) doesn't cost a rebuild.
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
