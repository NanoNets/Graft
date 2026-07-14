/**
 * The on-disk format of the context graph: a folder of plain markdown files
 * under `.context/`, one per node. The files ARE the graph — the frontmatter
 * carries the machine-readable node (identity, source provenance, edges) and
 * the body is human/agent-readable prose. There is no database.
 *
 * Layout of a node file:
 *
 *   ---                         ← YAML frontmatter (canonical, machine-owned)
 *   name / slug / type
 *   sources: [{path, hash}]     ← provenance + the staleness key
 *   sources_digest
 *   links: [{to, relation}]     ← edges (canonical form)
 *   ---
 *   <!-- context:generated:start -->
 *   ## Summary … ## Related …   ← regenerated on every `init`
 *   <!-- context:generated:end -->
 *   ## Notes …                  ← anything a human writes is preserved verbatim
 *
 * `.context/manifest.json` is a generated index over all nodes plus the full
 * file→hash map `init` saw, so `check` can detect drift in O(files) without an
 * LLM and without re-reading every node body.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { contentHash, normalizeName } from "../util/id.js";

/** A source file a node was derived from, with its content hash at generation time. */
export interface SourceRef {
  path: string;
  hash: string;
}

/** A directed edge to another node (by slug). */
export interface NodeLink {
  to: string;
  relation: string;
  description?: string;
}

/** A single node in the graph — one markdown file. */
export interface ContextNode {
  name: string;
  slug: string;
  /** Coarse category from extraction: system | service | api | concept | … */
  type: string;
  /** Prose description that becomes the node body. */
  summary: string;
  /** Source files that produced this node (empty only for hand-authored nodes). */
  sources: SourceRef[];
  /** sha256 over the sorted `path:hash` lines of {@link sources}. */
  sourcesDigest: string;
  /** Outbound edges. */
  links: NodeLink[];
  /** Free-form region below the generated block, preserved across re-runs. */
  human: string;
}

/** The generated index written alongside the node files. */
export interface Manifest {
  version: number;
  /** Human label for the model that built the graph, e.g. "openrouter:openai/gpt-4o-mini". */
  model: string;
  /** sha256 over every source file's `path:hash` — the whole-graph fingerprint. */
  repoDigest: string;
  /** Every source file `init` processed, with its hash. The staleness ground-truth. */
  files: SourceRef[];
  /** Node roster (a subset of each node's frontmatter, for fast reads). */
  nodes: Array<{ slug: string; name: string; type: string; sources: string[]; sourcesDigest: string }>;
}

export const MANIFEST_VERSION = 1;
const GEN_START = "<!-- context:generated:start -->";
const GEN_END = "<!-- context:generated:end -->";
const MANIFEST_FILE = "manifest.json";
/** Gitignored cache dir (per-file summaries + extractions), never committed. */
export const CACHE_DIR = ".cache";

/** Turn a display name into a stable, filesystem- and link-safe slug. */
export function slugify(name: string): string {
  const base = normalizeName(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "node";
}

/** sha256 over the sorted `path:hash` lines of a set of sources. */
export function digestSources(sources: SourceRef[]): string {
  const lines = sources
    .map((s) => `${s.path}:${s.hash}`)
    .sort()
    .join("\n");
  return contentHash(lines);
}

/** Absolute path of the `.context/` directory for a repo root. */
export function contextDirFor(root: string, override?: string): string {
  if (override) return override;
  return join(root, ".context");
}

/** Render the generated body (Summary + Related) for a node. */
function renderGenerated(node: ContextNode): string {
  const lines = [`## Summary`, ``, node.summary.trim() || "_(no summary)_", ``];
  if (node.links.length > 0) {
    lines.push(`## Related`, ``);
    for (const link of [...node.links].sort((a, b) => a.to.localeCompare(b.to))) {
      const rel = link.relation.replace(/_/g, " ");
      const tail = link.description ? ` — ${link.description}` : "";
      lines.push(`- ${rel} [[${link.to}]]${tail}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

/** Default human region for a brand-new node (preserved verbatim afterwards). */
function defaultHuman(): string {
  return `\n## Notes\n\n_Anything written below the generated block is preserved when the graph is regenerated._\n`;
}

/** Serialize a node to its full markdown file contents. */
export function renderNodeFile(node: ContextNode): string {
  const data = {
    name: node.name,
    slug: node.slug,
    type: node.type,
    sources: node.sources.map((s) => ({ path: s.path, hash: s.hash })),
    sources_digest: node.sourcesDigest,
    links: node.links.map((l) =>
      l.description ? { to: l.to, relation: l.relation, description: l.description } : { to: l.to, relation: l.relation },
    ),
    generator: { version: MANIFEST_VERSION },
  };
  const body = `${GEN_START}\n${renderGenerated(node)}${GEN_END}\n${node.human}`;
  // gray-matter appends a trailing newline; keep output stable across runs.
  return matter.stringify(body, data);
}

/**
 * Extract the human region (everything after the generated-end marker) from an
 * existing node file so it survives regeneration. If the markers are missing
 * (a hand-deleted or foreign file), returns a fresh default region.
 */
function preserveHuman(existingContent: string): string {
  const idx = existingContent.indexOf(GEN_END);
  if (idx === -1) return defaultHuman();
  return existingContent.slice(idx + GEN_END.length).replace(/^\n/, "");
}

/**
 * Write a node file, preserving any existing human region. Returns the file
 * path written.
 */
export function writeNode(dir: string, node: ContextNode): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${node.slug}.md`);
  if (existsSync(path)) {
    const parsed = matter(readFileSync(path, "utf8"));
    node = { ...node, human: preserveHuman(parsed.content) };
  } else {
    node = { ...node, human: node.human || defaultHuman() };
  }
  writeFileSync(path, renderNodeFile(node));
  return path;
}

/** A node file parsed back off disk (frontmatter only; body is not needed for `check`). */
export interface ParsedNode {
  slug: string;
  name: string;
  type: string;
  sources: SourceRef[];
  sourcesDigest: string;
  links: NodeLink[];
}

/** Read and parse every `.md` node file in a context dir (skips the manifest). */
export function readNodes(dir: string): ParsedNode[] {
  if (!existsSync(dir)) return [];
  const out: ParsedNode[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".md")) continue;
    const fm = matter(readFileSync(join(dir, entry), "utf8")).data as Record<string, unknown>;
    out.push({
      slug: String(fm.slug ?? entry.replace(/\.md$/, "")),
      name: String(fm.name ?? ""),
      type: String(fm.type ?? ""),
      sources: Array.isArray(fm.sources) ? (fm.sources as SourceRef[]) : [],
      sourcesDigest: String(fm.sources_digest ?? ""),
      links: Array.isArray(fm.links) ? (fm.links as NodeLink[]) : [],
    });
  }
  return out;
}

/** List the node files present (slug → filename), for pruning deleted nodes. */
export function existingNodeSlugs(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(/\.md$/, "")),
  );
}

/** Delete a node file by slug. */
export function deleteNode(dir: string, slug: string): void {
  const path = join(dir, `${slug}.md`);
  if (existsSync(path)) rmSync(path);
}

export function writeManifest(dir: string, manifest: Manifest): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
}

export function readManifest(dir: string): Manifest | undefined {
  const path = join(dir, MANIFEST_FILE);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}
