/**
 * `graft map` core: a deterministic, token-budgeted repo orientation —
 * directory clusters, per-directory hubs, and global hotspots — computed
 * purely from the wiring graph (no LLM, no I/O beyond the already-loaded
 * `GraphV1`).
 *
 * Grouping is by first path segment (`src/cache.ts` → `src`), so a coding
 * agent gets the same top-level shape a human sees in a file tree. When one
 * segment swallows most of the repo (a flat `src/` with everything under
 * it), that single group would be useless as an orientation aid, so it gets
 * one refinement pass: split one level deeper (`src` → `src/ask`,
 * `src/graph`, …). Hubs and hotspots rank by incoming `WALK_RELATIONS`
 * edges (shared with `graphrank.ts`/`grep.ts`, so "important" means the same
 * thing everywhere in graft) — never by lines of code or heuristics that
 * drift from the actual wiring.
 *
 * Pure and synchronous: same fixture-testable shape as `grep.ts` — no CLI or
 * MCP concerns live here. `cli.ts` and `mcp/tools.ts` both call
 * `buildRepoMap` + `formatRepoMap` directly.
 */
import type { GraphV1, NodeV1 } from "./types.js";
import { languageOf } from "./extract.js";
import { WALK_RELATIONS } from "./relations.js";
import { savingsFooter, savingsFor, type Savings } from "../context/savings.js";

export interface Hub {
  name: string;
  kind: string;
  path: string;
  span: string;
  inDegree: number;
}

export interface DirEntry {
  path: string;
  files: number;
  symbols: number;
  languages: string[];
  hubs: Hub[];
}

export interface RepoMap {
  totals: { files: number; symbols: number; edges: number; languages: string[] };
  /** Sorted by symbol count desc (ties by path asc), capped at `maxDirs`. */
  dirs: DirEntry[];
  /** Global top hubs by inDegree, ties by name asc then path asc. */
  hotspots: Hub[];
  /** Directory groups beyond the `maxDirs` cap — never silently dropped. */
  dropped: number;
  /** Tokens-saved baseline: every indexed file read whole — the cost of
   * orienting by reading the repo instead of this map. */
  saved?: Savings;
}

export interface BuildRepoMapOptions {
  /** Max directory entries kept (the rest are counted into `dropped`). Default 16. */
  maxDirs?: number;
  /** Max hubs listed per directory. Default 3. */
  hubsPerDir?: number;
  /** Max global hotspots. Default 12. */
  hotspots?: number;
}

const DEFAULT_MAX_DIRS = 16;
const DEFAULT_HUBS_PER_DIR = 3;
const DEFAULT_HOTSPOTS = 12;
/** A single group must not exceed this share of all file nodes, or it's
 * refined one path-segment deeper — see the module doc. */
const SPLIT_THRESHOLD = 0.6;

/** First `depth` path segments, joined back with `/`. Files with fewer
 * segments than `depth` (e.g. a root-level file at depth 2) just use every
 * segment they have — there's nothing deeper to split into. */
function dirKey(path: string, depth: number): string {
  const segments = path.split("/");
  return segments.slice(0, Math.min(depth, segments.length)).join("/");
}

/** Incoming WALK_RELATIONS edge count per target id — the same "coupling"
 * metric `grep.ts` uses, so a hub in `graft map` means the same thing as a
 * high-inDegree group in `graft grep`. */
function computeInDegree(graph: GraphV1): Map<string, number> {
  const deg = new Map<string, number>();
  for (const e of graph.edges) {
    if (!WALK_RELATIONS.has(e.relation)) continue;
    deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
  }
  return deg;
}

/** Top `cap` nodes by inDegree (ties broken by name asc, then path asc, for
 * full determinism regardless of the input nodes' array order), dropping
 * anything with zero inbound edges — a hub with no callers isn't a hub. */
function topHubs(nodes: NodeV1[], inDegree: Map<string, number>, cap: number): Hub[] {
  return nodes
    .map((n) => ({ name: n.name, kind: n.kind, path: n.path, span: n.span, inDegree: inDegree.get(n.id) ?? 0 }))
    .filter((h) => h.inDegree > 0)
    .sort((a, b) => b.inDegree - a.inDegree || a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
    .slice(0, cap);
}

function sortedLanguages(paths: string[]): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    const lang = languageOf(p);
    if (lang) set.add(lang);
  }
  return [...set].sort();
}

/**
 * Build the repo map from an already-loaded `GraphV1`. Deterministic: same
 * graph in → byte-identical `RepoMap` out (modulo insertion order, which is
 * never observed — everything meaningful is sorted).
 */
export function buildRepoMap(graph: GraphV1, opts: BuildRepoMapOptions = {}): RepoMap {
  const maxDirs = opts.maxDirs ?? DEFAULT_MAX_DIRS;
  const hubsPerDir = opts.hubsPerDir ?? DEFAULT_HUBS_PER_DIR;
  const hotspotsN = opts.hotspots ?? DEFAULT_HOTSPOTS;

  const fileNodes = graph.nodes.filter((n) => n.kind === "file");
  const totalFiles = fileNodes.length;

  // Pass 1: depth-1 file counts, to find (at most one) group over the
  // split threshold — two groups can't both exceed 60% of the same total.
  const depth1FileCounts = new Map<string, number>();
  for (const n of fileNodes) {
    const key = dirKey(n.path, 1);
    depth1FileCounts.set(key, (depth1FileCounts.get(key) ?? 0) + 1);
  }
  let splitSegment: string | null = null;
  if (totalFiles > 0) {
    for (const [seg, count] of depth1FileCounts) {
      if (count / totalFiles > SPLIT_THRESHOLD) {
        splitSegment = seg;
        break;
      }
    }
  }

  const depthFor = (path: string): number => (splitSegment !== null && dirKey(path, 1) === splitSegment ? 2 : 1);

  // Pass 2: assign every node (file and symbol alike) to its group.
  const groups = new Map<string, { files: NodeV1[]; symbols: NodeV1[] }>();
  for (const n of graph.nodes) {
    const key = dirKey(n.path, depthFor(n.path));
    let g = groups.get(key);
    if (!g) {
      g = { files: [], symbols: [] };
      groups.set(key, g);
    }
    if (n.kind === "file") g.files.push(n);
    else g.symbols.push(n);
  }

  const inDegree = computeInDegree(graph);

  const dirEntries: DirEntry[] = [...groups.entries()].map(([path, g]) => ({
    path,
    files: g.files.length,
    symbols: g.symbols.length,
    languages: sortedLanguages(g.files.map((f) => f.path)),
    hubs: topHubs(g.symbols, inDegree, hubsPerDir),
  }));

  dirEntries.sort((a, b) => b.symbols - a.symbols || a.path.localeCompare(b.path));
  const dropped = Math.max(0, dirEntries.length - maxDirs);
  const dirs = dirEntries.slice(0, maxDirs);

  const allSymbols = graph.nodes.filter((n) => n.kind !== "file");
  const hotspots = topHubs(allSymbols, inDegree, hotspotsN);

  return {
    totals: {
      files: totalFiles,
      symbols: allSymbols.length,
      edges: graph.edges.length,
      languages: sortedLanguages(fileNodes.map((f) => f.path)),
    },
    dirs,
    hotspots,
    dropped,
    saved: savingsFor(graph, fileNodes.map((f) => f.path)),
  };
}

const DIR_COL_WIDTH = 20;

function basenameOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

function formatDirHub(h: Hub): string {
  return `${h.name} (${basenameOf(h.path)}, ${h.inDegree}←)`;
}

function formatDirLine(d: DirEntry): string {
  const label = `${d.path}/`.padEnd(DIR_COL_WIDTH);
  const counts = `${d.files} files · ${d.symbols} symbols`;
  const hubs = d.hubs.length ? `   hubs: ${d.hubs.map(formatDirHub).join(", ")}` : "";
  return `${label}${counts}${hubs}`;
}

function formatHotspot(h: Hub): string {
  return `${h.name} · ${h.kind} · ${h.path}:${h.span} · ${h.inDegree}←`;
}

/**
 * Render a `RepoMap` as the human report. Deterministic (same map in → same
 * string out) and targets <= 6000 chars for a typical repo (the `maxDirs`/
 * `hubsPerDir`/`hotspots` caps in `buildRepoMap` are what keep it bounded on
 * very large graphs).
 */
export function formatRepoMap(map: RepoMap): string {
  const { totals } = map;
  const header = `repo map — ${totals.files} files · ${totals.symbols} symbols · ${totals.edges} edges · ${totals.languages.join(", ")}`;

  const lines: string[] = [header, ""];
  for (const d of map.dirs) lines.push(formatDirLine(d));
  if (map.dropped > 0) {
    lines.push(`… +${map.dropped} more director${map.dropped === 1 ? "y" : "ies"} not shown (raise max-dirs to see more)`);
  }
  lines.push("");
  lines.push(`hotspots: ${map.hotspots.map(formatHotspot).join("  ")}`);

  const body = lines.join("\n");
  return body + savingsFooter(body, map.saved) + "\n";
}
