/**
 * Scope discovery — finds sub-project boundaries inside a repo so ranking can
 * stay per-scope instead of pooling a monorepo's biggest sub-project against
 * everything else. A "scope" is rooted at a directory that carries a
 * project-marker file (`package.json`, `go.mod`, `pyproject.toml`, `setup.py`,
 * `Cargo.toml`).
 *
 * Discovery rules (see task brief for the numbered spec):
 *  1. Any directory with >=1 marker file is a scope candidate.
 *  2. Workspace-config-as-intent: `pnpm-workspace.yaml` or root `package.json`
 *     `workspaces` glob(s) are resolved and become the ONLY JS-family
 *     sub-scopes considered — other `package.json` dirs are ignored.
 *  3. Depth guard: candidates deeper than 2 path segments below root are
 *     ignored unless matched by a workspace glob.
 *  4. Nesting collapse: a candidate nested inside another is dropped (keep
 *     the shallower one) — except a workspace-glob match wins over its parent.
 *  5. Minimum-substance guard (< 5 non-file nodes merged into root) runs in
 *     `build.ts`, since node counts aren't known at walk time.
 *  6. If exactly the root scope survives (or nothing does), the canonical
 *     single-scope form `[{ prefix: "", label: "", markers: [...] }]` is emitted.
 *  7. `label` = `prefix` (both "" for root); ordering is prefix-length desc,
 *     then lexicographic.
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { SKIP_DIRS } from "../ingest/fs.js";
import type { GraphV1, ScopeV1 } from "./types.js";

/** Project-marker files, checked in this order (also the order `markers` is built in). */
const MARKERS = ["package.json", "go.mod", "pyproject.toml", "setup.py", "Cargo.toml"];

const CANONICAL_ROOT: ScopeV1[] = [{ prefix: "", label: "", markers: [] }];

/** Recursively collect every directory under `root` (posix rel path, "" = root itself),
 * reusing `walkDir`'s skip rules (dot-dirs, `SKIP_DIRS`) so build-output and dependency
 * trees are never scanned for markers. */
function collectDirs(root: string): string[] {
  const out: string[] = [""];
  const walk = (absDir: string, relDir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      out.push(rel);
      walk(join(absDir, entry.name), rel);
    }
  };
  walk(root, "");
  return out;
}

/** Minimal `packages:` list parser for `pnpm-workspace.yaml` — no YAML dependency,
 * handles the `packages:\n  - 'glob'\n  - "glob"` form pnpm actually generates. */
function parsePnpmPackagesList(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^packages\s*:/.test(l.trim()));
  if (idx === -1) return null;
  const globs: string[] = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    if (!/^\s*-\s*/.test(line)) break; // dedented — list ended
    const val = line.replace(/^\s*-\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (val) globs.push(val);
  }
  return globs.length ? globs : null;
}

/** Rule 2: resolve workspace-config-as-intent globs. Returns null when the repo has
 * no workspace config (pnpm-workspace.yaml wins over `package.json#workspaces` when
 * both exist). */
function readWorkspaceGlobs(root: string): string[] | null {
  const pnpmPath = join(root, "pnpm-workspace.yaml");
  if (existsSync(pnpmPath)) {
    try {
      const globs = parsePnpmPackagesList(readFileSync(pnpmPath, "utf8"));
      if (globs) return globs;
    } catch {
      /* malformed pnpm-workspace.yaml — fall through to package.json */
    }
  }
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      const ws = pkg.workspaces;
      if (Array.isArray(ws)) return ws as string[];
      if (ws && Array.isArray(ws.packages)) return ws.packages as string[];
    } catch {
      /* malformed package.json — no workspace intent */
    }
  }
  return null;
}

/** Resolve one workspace glob to matched dir paths (posix, rel to `root`). Supports
 * only `dir/*` (immediate subdirs) and `dir/**` (any nested depth) forms, implemented
 * with plain `readdir` — no glob dependency, per spec. Unsupported forms resolve empty. */
function resolveGlob(root: string, pattern: string): string[] {
  const norm = pattern.replace(/\\/g, "/").replace(/\/$/, "");
  let base: string;
  let recursive: boolean;
  if (norm === "**") {
    base = "";
    recursive = true;
  } else if (norm === "*") {
    base = "";
    recursive = false;
  } else if (norm.endsWith("/**")) {
    base = norm.slice(0, -3);
    recursive = true;
  } else if (norm.endsWith("/*")) {
    base = norm.slice(0, -2);
    recursive = false;
  } else if (!norm.includes("*")) {
    // Literal entry (no glob chars), e.g. `packages: ['apps/*', 'docs']` — a plain
    // workspace-list entry that names a real directory counts as a workspace match
    // in its own right, same as a resolved glob would. Without this, a literal
    // entry silently resolves to nothing while Rule 2 still strips its
    // `package.json` marker (it's a JS-family dir that never matched the glob
    // set), de-scoping a real workspace package.
    try {
      return existsSync(join(root, norm)) && statSync(join(root, norm)).isDirectory()
        ? [norm]
        : [];
    } catch {
      return [];
    }
  } else {
    return []; // unsupported glob form
  }

  const results: string[] = [];
  const listDirs = (absDir: string, relDir: string): string[] => {
    let entries: Dirent[];
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name))
      .map((e) => (relDir === "" ? e.name : `${relDir}/${e.name}`));
  };

  const baseAbs = base === "" ? root : join(root, base);
  if (!recursive) {
    results.push(...listDirs(baseAbs, base));
  } else {
    const stack = [base];
    while (stack.length) {
      const relDir = stack.pop()!;
      const absDir = relDir === "" ? root : join(root, relDir);
      const children = listDirs(absDir, relDir);
      results.push(...children);
      stack.push(...children);
    }
  }
  return results;
}

interface Candidate {
  markers: string[];
  isWorkspace: boolean;
}

/** Walk the tree (reusing `walkDir`'s skip rules) and find project-marker dirs. */
export function discoverScopes(root: string): ScopeV1[] {
  const absRoot = resolve(root);
  const dirs = collectDirs(absRoot);

  const markerMap = new Map<string, string[]>();
  for (const dir of dirs) {
    const found = MARKERS.filter((m) => existsSync(join(absRoot, dir, m)));
    if (found.length) markerMap.set(dir, found);
  }

  const workspaceGlobs = readWorkspaceGlobs(absRoot);
  const workspaceMatches = new Set<string>();
  if (workspaceGlobs) {
    for (const glob of workspaceGlobs) {
      for (const dir of resolveGlob(absRoot, glob)) workspaceMatches.add(dir);
    }
  }

  const candidates = new Map<string, Candidate>();

  for (const [dir, rawMarkers] of markerMap) {
    const isWorkspace = workspaceMatches.has(dir);
    let markers = rawMarkers;

    // Rule 2: with workspace config present, a non-matched dir's package.json
    // marker doesn't count — the globs are the only JS-family intent honored.
    if (workspaceGlobs && !isWorkspace && markers.includes("package.json")) {
      markers = markers.filter((m) => m !== "package.json");
      if (markers.length === 0) continue;
    }

    // Rule 3: depth guard (workspace matches are exempt).
    const depth = dir === "" ? 0 : dir.split("/").length;
    if (depth > 2 && !isWorkspace) continue;

    candidates.set(dir, { markers, isWorkspace });
  }

  // Workspace-matched dirs are candidates even without a marker file of their own.
  for (const dir of workspaceMatches) {
    const existing = candidates.get(dir);
    if (existing) existing.isWorkspace = true;
    else candidates.set(dir, { markers: markerMap.get(dir) ?? [], isWorkspace: true });
  }

  // Rule 4: nesting collapse — evaluated in two ordered passes against FROZEN
  // snapshots (deletions are marked first, then applied), never against the
  // live `candidates` map mid-iteration. That's what makes the outcome
  // layout-determined instead of `readdirSync`/Map-iteration-order-determined:
  // deciding "does ancestor X still exist" by checking a map you're
  // simultaneously deleting from means the answer depends on which candidate
  // happens to be visited first, which depends on directory read order.
  //
  //   Pass A — workspace override (uses the ORIGINAL frozen candidate set):
  //     for every workspace-glob candidate, find its nearest candidate
  //     ancestor in the original set; if that ancestor is not itself a
  //     workspace match, queue it for deletion ("a workspace-glob match wins
  //     over its parent"). All Pass-A deletions are collected first, then
  //     applied together — so it doesn't matter which workspace candidate is
  //     considered first, the ancestor lookups all read the same frozen set.
  //     Applying them produces the "post-glob-resolution" stable set.
  //
  //   Pass B — plain nesting collapse (uses the POST-A set, NOT the original
  //     frozen set): for every remaining candidate, find its nearest ancestor
  //     in the post-A set; if one exists, the deeper candidate is queued for
  //     deletion (keep the shallower ancestor) UNLESS it's a workspace match
  //     whose ancestor is NOT itself a workspace match — that's the one case
  //     Pass A already grants immunity to ("workspace beats a non-workspace
  //     parent"). Rule 4's workspace exception does NOT extend to a workspace
  //     candidate nested under ANOTHER workspace candidate (e.g. a recursive
  //     `packages/**` glob matching both `packages/a` and `packages/a/b`, or a
  //     `packages/**` glob sweeping every markerless dir under a real package)
  //     — that pair falls back to the plain rule, same as any other nested
  //     pair: keep the shallower, drop the deeper.
  //
  // Running Pass B against the post-A set (rather than the frozen one) is
  // what makes a Pass-A deletion visible downstream: a candidate whose only
  // nesting ancestor was itself removed by the workspace override is no
  // longer "nested" and survives — regardless of whether that candidate or
  // the workspace match happened to be discovered first on disk.
  const findNearestAncestorCandidate = (
    prefix: string,
    set: ReadonlyMap<string, Candidate>,
  ): string | null => {
    const segs = prefix.split("/");
    for (let i = segs.length - 1; i >= 1; i--) {
      const ancestor = segs.slice(0, i).join("/");
      if (set.has(ancestor)) return ancestor;
    }
    return null;
  };

  const frozen: ReadonlyMap<string, Candidate> = new Map(candidates);

  const passADeletes = new Set<string>();
  for (const [prefix, entry] of frozen) {
    if (!entry.isWorkspace) continue;
    const ancestor = findNearestAncestorCandidate(prefix, frozen);
    if (ancestor && !frozen.get(ancestor)!.isWorkspace) passADeletes.add(ancestor);
  }
  for (const prefix of passADeletes) candidates.delete(prefix);

  const postA: ReadonlyMap<string, Candidate> = new Map(candidates);
  const passBDeletes = new Set<string>();
  for (const [prefix, entry] of postA) {
    if (prefix === "") continue;
    const ancestor = findNearestAncestorCandidate(prefix, postA);
    if (!ancestor) continue;
    const ancestorEntry = postA.get(ancestor)!;
    // Keep only a workspace candidate whose nearest surviving ancestor is
    // NOT itself a workspace match (Pass A's exemption). Every other nested
    // pair — non-workspace child under anything, or workspace child under an
    // ALSO-workspace ancestor — collapses to the shallower one here.
    if (!entry.isWorkspace || ancestorEntry.isWorkspace) passBDeletes.add(prefix);
  }
  for (const prefix of passBDeletes) candidates.delete(prefix);

  const survivors = [...candidates.entries()].map(([prefix, c]) => ({ prefix, ...c }));

  // Rule 6: canonical single-scope form when only root survives, or nothing does.
  if (survivors.length === 0) return CANONICAL_ROOT;
  if (survivors.length === 1 && survivors[0].prefix === "") {
    return [{ prefix: "", label: "", markers: survivors[0].markers }];
  }

  const scopes: ScopeV1[] = survivors.map((s) => ({
    prefix: s.prefix,
    label: s.prefix,
    markers: s.markers,
  }));
  // Rule 7: deterministic ordering — prefix-length desc, then lexicographic.
  scopes.sort((a, b) => b.prefix.length - a.prefix.length || a.prefix.localeCompare(b.prefix));
  return scopes;
}

/** Nearest-prefix owner. `scopes` MUST be sorted prefix-length desc; "" matches all.
 * Falls back to a synthetic root scope when `scopes` has no explicit "" entry and
 * nothing else matches — every path resolves to some scope. */
export function scopeOf(path: string, scopes: ScopeV1[]): ScopeV1 {
  for (const s of scopes) {
    if (s.prefix === "") continue; // root is the fallback, checked last
    if (path === s.prefix || path.startsWith(`${s.prefix}/`)) return s;
  }
  return scopes.find((s) => s.prefix === "") ?? { prefix: "", label: "", markers: [] };
}

/** Display form of a scope prefix: "" reads as "(root)", everything else gets
 * a trailing slash. Shared by ask's `matched in:`/`also matched:` footer, the
 * `--in` no-match error, and the multi-scope zero-hit note. */
export function scopeLabel(prefix: string): string {
  return prefix === "" ? "(root)" : `${prefix}/`;
}

/** " — scopes here: a/ · b/" when `scopes` is genuinely multi-scope (>1
 * entries), else "" — the shared clause `ask` appends to its zero-hit note
 * and its `--in` no-match error, so a caller is always told what IS indexed
 * rather than getting a bare miss. */
export function scopesHereClause(scopes: ScopeV1[]): string {
  if (scopes.length <= 1) return "";
  return ` — scopes here: ${scopes.map((s) => scopeLabel(s.prefix)).join(" · ")}`;
}

/** Segment-aware "is `path` at or under `prefix`?" — a plain `path.startsWith`
 * would wrongly let "frontend" match "frontend-utils"; this requires an exact
 * segment boundary, same rule `scopeOf` uses for its own prefix match. Root
 * (`""`) matches every path. Used to filter ask's doc/node set for
 * `--in <path-prefix>`. */
export function pathUnderPrefix(path: string, prefix: string): boolean {
  return prefix === "" || path === prefix || path.startsWith(`${prefix}/`);
}

/** Immediate subdirs of `root` that are themselves git repos (have `.git`).
 * Used by workspace federation (Task 5). */
export function discoverWorkspaceChildren(root: string): string[] {
  const absRoot = resolve(root);
  let entries: Dirent[];
  try {
    entries = readdirSync(absRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith(".") &&
        !SKIP_DIRS.has(e.name) &&
        existsSync(join(absRoot, e.name, ".git")),
    )
    .map((e) => e.name);
}

/** Every consumer's entry point to a graph's scopes: absent `meta.scopes` (old
 * graphs, or graphs where discovery found nothing but the root) defaults to the
 * canonical single-scope form. Never read `graph.meta.scopes` directly. */
export function scopesOfGraph(graph: GraphV1): ScopeV1[] {
  return graph.meta.scopes ?? CANONICAL_ROOT;
}
