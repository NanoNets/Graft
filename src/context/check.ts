/**
 * `check` — is the committed `.context/` graph still in sync with the code?
 *
 * Pure I/O + hashing: no LLM, no network, milliseconds. It re-hashes the source
 * files the manifest recorded and compares. Meant to run in CI: exit 0 when the
 * graph is fresh, 1 when it has drifted (so a PR that changed code but not the
 * graph fails until `context-graph init` is re-run and committed).
 *
 * Drift categories:
 *   content     a recorded source file's bytes changed
 *   removed     a recorded source file no longer exists
 *   coverage    a code file exists that no node was built from (new/uningested)
 *   index       a node's frontmatter disagrees with the manifest (hand-edited)
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { contentHash } from "../util/id.js";
import { CODE_EXTENSIONS } from "./build.js";
import { contextDirFor, readManifest, readNodes } from "./node-file.js";

export interface CheckResult {
  ok: boolean;
  /** True when there is no graph at all (init has never run). */
  missing: boolean;
  contentDrift: Array<{ path: string; from: string; to: string }>;
  removed: string[];
  coverage: string[];
  indexDrift: string[];
}

export interface CheckOptions {
  contextDir?: string;
  extensions?: string[];
}

export function checkContext(dir: string, opts: CheckOptions = {}): CheckResult {
  const root = resolve(dir);
  const outDir = contextDirFor(root, opts.contextDir);
  const exts = opts.extensions ?? CODE_EXTENSIONS;

  const result: CheckResult = {
    ok: false,
    missing: false,
    contentDrift: [],
    removed: [],
    coverage: [],
    indexDrift: [],
  };

  const manifest = readManifest(outDir);
  if (!manifest) {
    result.missing = true;
    return result;
  }

  // Current code files on disk (same rules `init` used).
  const current = new Map<string, string>(); // rel → hash
  for (const file of walkDir(root)) {
    if (file.startsWith(outDir)) continue;
    if (!exts.some((e) => file.toLowerCase().endsWith(e))) continue;
    try {
      current.set(relative(root, file), contentHash(readFileSync(file, "utf8")));
    } catch {
      // Unreadable now → treat as removed below (it won't be in `current`).
    }
  }

  // Compare the manifest's recorded files against what's on disk.
  const recorded = new Set<string>();
  for (const ref of manifest.files) {
    recorded.add(ref.path);
    const now = current.get(ref.path);
    if (now === undefined) {
      result.removed.push(ref.path);
    } else if (now !== ref.hash) {
      result.contentDrift.push({ path: ref.path, from: short(ref.hash), to: short(now) });
    }
  }
  for (const path of current.keys()) {
    if (!recorded.has(path)) result.coverage.push(path);
  }

  // Node frontmatter must agree with the manifest roster (catches hand edits).
  const manifestNodes = new Map(manifest.nodes.map((n) => [n.slug, n]));
  const onDisk = readNodes(outDir);
  const seen = new Set<string>();
  for (const node of onDisk) {
    seen.add(node.slug);
    const m = manifestNodes.get(node.slug);
    if (!m) {
      result.indexDrift.push(`${node.slug}: node file not in manifest`);
    } else if (m.sourcesDigest !== node.sourcesDigest) {
      result.indexDrift.push(`${node.slug}: frontmatter digest ≠ manifest`);
    }
  }
  for (const slug of manifestNodes.keys()) {
    if (!seen.has(slug)) result.indexDrift.push(`${slug}: in manifest but node file missing`);
  }

  result.ok =
    result.contentDrift.length === 0 &&
    result.removed.length === 0 &&
    result.coverage.length === 0 &&
    result.indexDrift.length === 0;
  return result;
}

/** Render a check result as a human-readable report. */
export function formatCheckReport(r: CheckResult): string {
  if (r.missing) {
    return "context-graph check: NO GRAPH\n\nNo .context/manifest.json found. Run `context-graph init` first.";
  }
  if (r.ok) return "context-graph check: OK — the graph is in sync with the code.";

  const lines: string[] = ["context-graph check: STALE", ""];
  if (r.contentDrift.length) {
    lines.push(`changed (${r.contentDrift.length}):`);
    for (const c of r.contentDrift) lines.push(`  ~ ${c.path}  (${c.from} → ${c.to})`);
  }
  if (r.removed.length) {
    lines.push(`removed (${r.removed.length}):`);
    for (const p of r.removed) lines.push(`  - ${p}`);
  }
  if (r.coverage.length) {
    lines.push(`not in graph (${r.coverage.length}):`);
    for (const p of r.coverage) lines.push(`  + ${p}`);
  }
  if (r.indexDrift.length) {
    lines.push(`index mismatch (${r.indexDrift.length}):`);
    for (const s of r.indexDrift) lines.push(`  ! ${s}`);
  }
  lines.push("", "Run `context-graph init` to regenerate, then commit .context/.");
  return lines.join("\n");
}

function short(hash: string): string {
  return hash.slice(0, 8);
}
