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
 * Whether a directory named `name` should be skipped when walking a repo tree:
 * any dot-prefixed directory (`.git`, `.github`, `.vscode`, ...) or one of
 * {@link SKIP_DIRS} not named in `includes`. The single source of truth for
 * "is this dir source" — `skippedPath` and `walkFilesystem` below and the
 * git-child discovery in `graph/scopes.ts` share it, so they can never
 * independently drift on what counts as skippable.
 *
 * `includes` is the explicit, per-repo `graft build --include-dir` override
 * (persisted via `util/state.ts`'s `readIncludeDirs`, threaded in by each
 * caller) — a name in it is removed from the effective skip set for THIS
 * repo's walks. Absent/empty ≡ today's default behavior. It lifts only
 * graft's own skip list: in a Git repo, Git's ignore rules stay authoritative
 * (see {@link walkDir}).
 *
 * KNOWN LIMITATION: a dot-directory is skipped WHOLESALE and is NEVER
 * overridable, even via `includes` — unlike `SKIP_DIRS`, there is no path to
 * un-skip one. A repo that keeps real, hand-written source under a
 * dot-prefixed directory is out of scope.
 */
export function shouldSkipDir(name: string, includes?: ReadonlySet<string>): boolean {
  if (name.startsWith(".")) return true;
  if (includes?.has(name)) return false;
  return SKIP_DIRS.has(name);
}

/**
 * Recursively list all files under a directory. Skips dot-directories,
 * dependency/build directories (node_modules, dist, …) not named in
 * `includes`, and files over 1 MB.
 * In a Git worktree, tracked files plus untracked, non-ignored files come from
 * `git ls-files`; this gives indexing exactly Git's nested `.gitignore`,
 * negation, and global-exclude semantics. Non-Git directories retain the plain
 * filesystem walk. `includes` lifts only the built-in skip list — it never
 * overrides Git's ignore rules (un-ignore or `git add -f` a directory to
 * index it, the same contract as tracked-but-ignored files).
 */
export function walkDir(dir: string, includes?: ReadonlySet<string>): string[] {
  assertRepoDir(dir);
  return gitVisibleFiles(dir, includes) ?? walkFilesystem(dir, includes);
}

/**
 * Fail on a bad `[dir]` here, where the argument is still named, rather than four
 * frames down in `readdirSync`.
 *
 * `graft build ./typo` used to reach the user as `ENOENT: no such file or directory,
 * scandir 'C:\...'` — cli.ts's top-level handler prints `err.message` and nothing else,
 * so the message never mentioned `graft build` or which argument was wrong. Every
 * command that takes a repo root funnels through this walk, so validating once here
 * covers `build`, `init` and `check` without each of them remembering to.
 *
 * Note the git path can't do this check for us: `gitVisibleFiles` spawns with
 * `cwd: root`, and a spawn into a nonexistent cwd merely returns an error, which the
 * walker fail-softs into the filesystem fallback.
 *
 * Exported because the walk is not always the FIRST thing a command does with the
 * argument: `graft build ./typo --include-dir x` persisted a config file first, and
 * `writeJsonAtomic` mkdir's recursively — so a typo silently created the directory
 * it was complaining about. cli.ts calls this up front for exactly that reason; the
 * check stays here so both callers can never disagree on the wording.
 */
export function assertRepoDir(dir: string): void {
  let stat;
  try {
    stat = statSync(dir);
  } catch {
    throw new Error(`✗ ${dir}: no such directory — pass a repository root`);
  }
  if (!stat.isDirectory()) throw new Error(`✗ ${dir}: not a directory — pass a repository root`);
}

/** Git's canonical working-tree file set, relative to `dir`. Tracked files are
 * deliberately included even when a later ignore rule matches them; `.gitignore`
 * only controls untracked files in Git, and graft follows the same contract. */
function gitVisibleFiles(dir: string, includes?: ReadonlySet<string>): string[] | null {
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
  // `ls-files` prints one line PER INDEX STAGE, so during a merge conflict every
  // unmerged path arrives three times (stages 1/2/3). Nothing downstream deduplicates:
  // `listSourceStats` yields three SourceStats with the same `rel`, and build.ts's loop
  // re-parses and re-pushes the same nodes three times, minting three nodes per id.
  // `checkGraphInvariants` then reports `duplicate node id`, meta.nodeCount is inflated,
  // and `ask` scores the same body 3×. The Claude Code `Stop` hook runs a build at the
  // end of every turn, so this fires on its own in the middle of a conflicted merge.
  // A Set rather than git's `--deduplicate` flag: that flag needs git >= 2.31 and this
  // has to hold on whatever git the user has.
  const seen = new Set<string>();
  for (const rel of result.stdout.split("\0")) {
    if (!rel || seen.has(rel) || skippedPath(rel, includes)) continue;
    seen.add(rel);
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

/** A path (git-relative, either separator) is skipped when any of its
 * segments is a skippable directory name — the final segment doubles as the
 * dot-FILE check (`.eslintrc.js` and friends are not source either). */
function skippedPath(path: string, includes?: ReadonlySet<string>): boolean {
  return path.replace(/\\/g, "/").split("/").some((segment) => shouldSkipDir(segment, includes));
}

function walkFilesystem(dir: string, includes?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name, includes)) continue;
      out.push(...walkFilesystem(full, includes));
    } else if (entry.isFile()) {
      if (entry.name.startsWith(".")) continue; // dot-files are not source either
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
