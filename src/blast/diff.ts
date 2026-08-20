/**
 * What a PR touched, read from git: changed files plus the *line ranges* inside
 * them, which is what turns a diff into graph seeds (an enclosing-symbol lookup
 * per changed line, see `blast.ts`).
 *
 * Git is shelled out to rather than parsed from a library because the CI job
 * this feeds already has git — and `--unified=0` gives exactly the post-image
 * line ranges we need, with no context lines to subtract back out.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

/** A contiguous run of changed lines, in POST-image (new file) line numbers. */
export interface LineRange {
  start: number;
  end: number;
}

export interface ChangedFile {
  /** Repo-relative posix path, post-image (the new name for a rename). */
  path: string;
  status: ChangeStatus;
  /** Pre-image path, renames only. */
  oldPath?: string;
  /** Post-image changed line ranges. Empty for a pure delete or a mode-only change. */
  ranges: LineRange[];
}

export interface DiffResult {
  /** Human label for what was compared, e.g. "origin/main...HEAD". */
  basis: string;
  files: ChangedFile[];
}

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/** Run git in `root`, or return null when git fails (not a repo, unknown ref). */
function git(root: string, args: string[]): string | null {
  const res = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0 || typeof res.stdout !== "string") return null;
  return res.stdout;
}

/** True when `ref` names something git can resolve — checked before diffing so
 * an unknown `--base` fails with a caller-facing message, not a git stack. */
export function refExists(root: string, ref: string): boolean {
  return git(resolve(root), ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}

/**
 * The diff arguments for a base ref, and the label to show for it.
 *
 * `<base>...HEAD` (three dots) diffs against the MERGE BASE, not the tip of the
 * base branch — the difference matters on every PR whose base branch moved after
 * it was cut: two-dot would attribute other people's merges to this PR and
 * inflate the blast radius with files the author never touched.
 */
function rangeArgs(base: string): { args: string[]; basis: string } {
  return { args: [`${base}...HEAD`], basis: `${base}...HEAD` };
}

/**
 * Changed files + post-image line ranges.
 *
 * With no `base` this reports the working tree against HEAD (the local
 * "what am I about to push" case), falling back to the last commit when the
 * tree is clean — so the command answers something useful when run by hand,
 * and CI passes `--base` for the real PR range.
 */
export function changedFiles(root: string, base?: string): DiffResult | null {
  const dir = resolve(root);
  if (base !== undefined) {
    const { args, basis } = rangeArgs(base);
    const files = diffFiles(dir, args);
    return files === null ? null : { basis, files };
  }

  const working = diffFiles(dir, ["HEAD"]);
  if (working === null) return null;
  if (working.length > 0) return { basis: "working tree vs HEAD", files: working };

  const last = diffFiles(dir, ["HEAD~1...HEAD"]);
  if (last === null) return { basis: "working tree vs HEAD", files: [] };
  return { basis: "HEAD~1...HEAD", files: last };
}

/** Both git passes for one range: name-status (statuses, renames) then hunks. */
function diffFiles(dir: string, range: string[]): ChangedFile[] | null {
  const status = git(dir, ["diff", "--name-status", "--find-renames", "-z", ...range, "--"]);
  if (status === null) return null;
  const files = parseNameStatus(status);
  if (files.length === 0) return files;

  const patch = git(dir, [
    "diff",
    "--unified=0",
    "--no-color",
    "--no-ext-diff",
    "--find-renames",
    ...range,
    "--",
  ]);
  if (patch !== null) applyHunks(files, patch);
  return files;
}

/**
 * `--name-status -z` output: NUL-separated fields, where a rename spends THREE
 * fields (`R096`, old, new) and everything else spends two. Splitting on NUL and
 * walking with a cursor is the only way to read it — a line-oriented parse
 * silently pairs a rename's old path with the next file's status.
 */
function parseNameStatus(out: string): ChangedFile[] {
  const fields = out.split("\0").filter((f) => f !== "");
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; ) {
    const code = fields[i++];
    if (code.startsWith("R") || code.startsWith("C")) {
      const oldPath = fields[i++];
      const path = fields[i++];
      if (path === undefined) break;
      files.push({ path, status: "renamed", oldPath, ranges: [] });
      continue;
    }
    const path = fields[i++];
    if (path === undefined) break;
    if (code.startsWith("A")) files.push({ path, status: "added", ranges: [] });
    else if (code.startsWith("D")) files.push({ path, status: "deleted", ranges: [] });
    else files.push({ path, status: "modified", ranges: [] });
  }
  return files;
}

/** Attach each hunk's post-image range to its file. */
function applyHunks(files: ChangedFile[], patch: string): void {
  const byPath = new Map(files.map((f) => [f.path, f]));
  let current: ChangedFile | undefined;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4);
      current = raw === "/dev/null" ? undefined : byPath.get(stripPrefix(raw));
      continue;
    }
    if (!line.startsWith("@@") || !current) continue;
    const m = HUNK_RE.exec(line);
    if (!m) continue;
    const start = Number(m[1]);
    // `+N,0` is a pure deletion: nothing survives in the post-image, and git
    // reports the line BEFORE the gap. Recording that single line is what keeps
    // "the body of foo() lost 10 lines" attributable to foo() at all.
    const count = m[2] === undefined ? 1 : Number(m[2]);
    current.ranges.push(count === 0 ? { start, end: start } : { start, end: start + count - 1 });
  }
}

/** `b/src/x.ts` → `src/x.ts`, minus any trailing tab-separated timestamp. */
function stripPrefix(raw: string): string {
  const untabbed = raw.split("\t")[0];
  return untabbed.startsWith("b/") ? untabbed.slice(2) : untabbed;
}
