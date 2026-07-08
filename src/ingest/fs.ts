/**
 * Filesystem walking/filtering rules shared by directory ingestion and the
 * auto-watch daemon, so both always agree on which files are knowledge.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Extensions treated as documents by `ingestDir` and the watcher. */
export const DOC_EXTENSIONS = [".pdf", ".md", ".markdown", ".txt"];

/** Directories that are dependency/build output, never knowledge. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  "venv",
]);

/** Files above this size are generated/vendored in practice, not written docs or code. */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Recursively list all files under a directory. Skips dot-directories,
 * dependency/build directories (node_modules, dist, …), and files over 1 MB.
 */
export function walkDir(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkDir(full));
    } else if (entry.isFile()) {
      try {
        if (statSync(full).size > MAX_FILE_BYTES) continue;
      } catch {
        continue;
      }
      out.push(full);
    }
  }
  return out;
}

/** True if any path segment is a dot-entry or a SKIP_DIRS directory. */
function hasSkippedSegment(path: string): boolean {
  return path
    .split(sep)
    .some((seg) => seg.length > 0 && (seg.startsWith(".") || SKIP_DIRS.has(seg)));
}

/**
 * True if this path passes the same rules {@link walkDir} applies below
 * `root`: a matching extension, no dot-file/dot-dir or SKIP_DIRS segment
 * under the root, and at most 1 MB. The root itself is exempt from the
 * segment rules — watching `~/.notes` is legitimate, just as `walkDir` never
 * inspects the directory it was pointed at.
 */
export function isIngestablePath(
  path: string,
  root: string,
  extensions: string[] = DOC_EXTENSIONS,
): boolean {
  if (hasSkippedSegment(relative(root, path))) return false;
  const lower = path.toLowerCase();
  if (!extensions.some((e) => lower.endsWith(e))) return false;
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * Predicate for a file watcher's `ignored` option: true for dot/SKIP_DIRS
 * entries below `root` (so they are never descended into) and for oversized
 * files. Extension filtering is left to the event handler — watchers hand us
 * stats only sometimes, and directories have no extension to test.
 */
export function shouldIgnorePath(
  path: string,
  root: string,
  stats?: { isDirectory(): boolean; size: number },
): boolean {
  if (hasSkippedSegment(relative(root, path))) return true;
  if (stats && !stats.isDirectory() && stats.size > MAX_FILE_BYTES) return true;
  return false;
}
