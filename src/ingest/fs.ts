/**
 * Filesystem walking used by `init`/`check` to enumerate a repo's source files.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { type Ignore } from "ignore";
import { SKIP_DIRS, createDefaultIgnore } from "./ignore-rules.js";

export { SKIP_DIRS };

/** Files above this size are generated/vendored in practice, not hand-written code. */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Load default ecosystem ignore rules combined with root `.graftignore` if present.
 * Only the root directory `.graftignore` is considered.
 */
export function loadGraftIgnore(rootDir: string): Ignore {
  const ig = createDefaultIgnore();
  const path = join(rootDir, ".graftignore");
  if (existsSync(path)) {
    try {
      const content = readFileSync(path, "utf8");
      ig.add(content);
    } catch {
      // Ignore unreadable .graftignore
    }
  }
  return ig;
}

/**
 * Recursively list all files under a directory. Skips dot-directories,
 * dependency/build directories (node_modules, dist, …), files over 1 MB,
 * and paths ignored by root `.graftignore`.
 */
export function walkDir(dir: string, rootDir: string = dir, ig?: Ignore | null): string[] {
  if (ig === undefined) {
    ig = loadGraftIgnore(rootDir);
  }
  const out: string[] = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    const relPath = relative(rootDir, full).split(sep).join("/");

    if (entry.isDirectory()) {
      if (ig && (ig.ignores(relPath) || ig.ignores(`${relPath}/`))) continue;
      out.push(...walkDir(full, rootDir, ig));
    } else if (entry.isFile()) {
      if (ig && ig.ignores(relPath)) continue;
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
