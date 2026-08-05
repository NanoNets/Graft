/**
 * Filesystem walking used by `init`/`check` to enumerate a repo's source files.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** Directories that are dependency/build output, never source. */
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

/** Files above this size are generated/vendored in practice, not hand-written code. */
export const MAX_FILE_BYTES = 1_000_000;

/**
 * Recursively list all files under a directory. Skips dot-directories,
 * dependency/build directories (node_modules, dist, …), and files over 1 MB.
 * In a Git worktree, tracked files plus untracked, non-ignored files come from
 * `git ls-files`; this gives indexing exactly Git's nested `.gitignore`,
 * negation, and global-exclude semantics. Non-Git directories retain the plain
 * filesystem walk.
 */
export function walkDir(dir: string): string[] {
  return gitVisibleFiles(dir) ?? walkFilesystem(dir);
}

/** Git's canonical working-tree file set, relative to `dir`. Tracked files are
 * deliberately included even when a later ignore rule matches them; `.gitignore`
 * only controls untracked files in Git, and graft follows the same contract. */
function gitVisibleFiles(dir: string): string[] | null {
  const root = resolve(dir);
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--"],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (result.status !== 0 || result.error || typeof result.stdout !== "string") return null;

  const out: string[] = [];
  for (const rel of result.stdout.split("\0")) {
    if (!rel || skippedPath(rel)) continue;
    const abs = resolve(root, rel);
    try {
      const stat = lstatSync(abs);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
    } catch {
      // A tracked file deleted from the working tree is still printed by
      // `--cached`; absence means it is not part of the current source set.
      continue;
    }
    out.push(abs);
  }
  return out;
}

function skippedPath(path: string): boolean {
  const segments = path.replace(/\\/g, "/").split("/");
  return segments.some((segment) => segment.startsWith(".") || SKIP_DIRS.has(segment));
}

function walkFilesystem(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walkFilesystem(full));
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
