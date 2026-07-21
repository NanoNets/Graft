/**
 * `graph` — build `.context/graph.json` from a code repository.
 *
 * M1 pipeline (Tier-1 only, deterministic, no LLM):
 *   1. Walk the repo for TS/Python source files.
 *   2. Parse each with tree-sitter and emit one NodeV1 per definition.
 *   3. Write a sorted graph.json.
 * Edges (M2) and LLM summary/crux (M3) layer onto this without changing it.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { contextDirFor } from "../context/node-file.js";
import { extractFile, languageOf, type Language, type RawEdge } from "./extract.js";
import { resolveEdges, type GoModule } from "./resolve.js";
import { enrichGraph, type EnrichStats } from "./enrich.js";
import { readGraph, writeGraph, wiringPath } from "./write.js";
import { writeCards, writeIndex, writeCovers } from "./cards.js";
import { writeAskIndex } from "../ask/index-file.js";
import type { GraphV1, Kind, NodeV1, Relation } from "./types.js";
import type { CruxSummarizer } from "../ai/crux.js";

export interface GraphBuildOptions {
  /** Override the output dir (default: `<root>/.context`). */
  contextDir?: string;
  /** Run the Tier-2 LLM meaning pass. Absent → Tier-1 only (cache is still preserved). */
  summarizer?: CruxSummarizer;
  /** Max files summarized in parallel during the Tier-2 pass. Default is set in enrich. */
  concurrency?: number;
  onProgress?: (info: {
    phase: "parse" | "enrich";
    index: number;
    total: number;
    file: string;
  }) => void;
}

export interface GraphBuildResult {
  contextDir: string;
  graphPath: string;
  /** Per-file wiring cards written (Tier-2 passive surface). */
  cards: number;
  files: number;
  nodes: number;
  edges: number;
  byKind: Record<Kind, number>;
  byRelation: Record<Relation, number>;
  languages: string[];
  meaning: EnrichStats;
  errors: string[];
}

/** The source files a graph build parses: supported languages, minus the output dir. */
export function listSourceFiles(root: string, outDir: string): string[] {
  return walkDir(root).filter((f) => !f.startsWith(outDir) && languageOf(f) !== null);
}

/** Every Go module in the repo: each `go.mod`'s declared `module` path and the repo
 * directory it lives in (posix, `.` for the root). Found anywhere in the tree, so a
 * monorepo whose module is in a subdir (e.g. `backend/go.mod`) resolves too. Lets edge
 * resolution map Go import paths to in-repo files. */
function readGoModules(root: string): GoModule[] {
  const mods: GoModule[] = [];
  for (const f of walkDir(root)) {
    if (basename(f) !== "go.mod") continue;
    try {
      const m = readFileSync(f, "utf8").match(/^\s*module\s+(\S+)/m);
      if (!m) continue;
      const rel = relative(root, dirname(f)).split(sep).join("/");
      mods.push({ module: m[1], dir: rel === "" ? "." : rel });
    } catch {
      /* unreadable go.mod — skip this module */
    }
  }
  return mods;
}

export async function buildGraph(
  dir: string,
  opts: GraphBuildOptions = {},
): Promise<GraphBuildResult> {
  const root = resolve(dir);
  const outDir = contextDirFor(root, opts.contextDir);
  const files = listSourceFiles(root, outDir);

  const nodes: NodeV1[] = [];
  const rawEdges: RawEdge[] = [];
  const sources = new Map<string, string>();
  const langs = new Set<Language>();
  const errors: string[] = [];

  files.forEach((file, i) => {
    const rel = relative(root, file);
    opts.onProgress?.({ phase: "parse", index: i, total: files.length, file: rel });
    const lang = languageOf(file)!;
    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch (err) {
      errors.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    try {
      const { nodes: fileNodes, rawEdges: fileEdges } = extractFile(rel, source, lang);
      nodes.push(...fileNodes);
      rawEdges.push(...fileEdges);
      sources.set(rel, source);
      langs.add(lang);
    } catch (err) {
      errors.push(`${rel}: parse failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  const edges = resolveEdges(nodes, rawEdges, { goModules: readGoModules(root) });

  // graph.json is its own Tier-2 cache: fold in the prior meaning layer so an
  // unchanged body is never re-summarized (and a Tier-1-only run never wipes it).
  const prior = readGraph(wiringPath(outDir));
  const priorById = new Map((prior?.nodes ?? []).map((n) => [n.id, n]));
  const meaning = await enrichGraph(nodes, priorById, sources, {
    summarizer: opts.summarizer,
    concurrency: opts.concurrency,
    onProgress: ({ index, total, node }) =>
      opts.onProgress?.({ phase: "enrich", index, total, file: node }),
  });
  errors.push(...meaning.errors);

  const graph: GraphV1 = {
    meta: {
      version: 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      languages: [...langs].sort(),
    },
    nodes,
    edges,
  };

  const graphPath = writeGraph(graph, outDir);
  // `ask`'s token/IDF sidecar — moves per-query corpus tokenization to build
  // time (~45% of query time on a 32k-node graph, profiled). Lives in the
  // cache dir; `ask` falls back to live tokenization when it's absent/stale.
  // Best-effort: wiring.json is already on disk at this point, so a sidecar
  // write failure (e.g. an unwritable cache dir) must not abort cards/index/
  // covers below — record it and keep going, same as other recoverable errors.
  //
  // MUST pass the in-memory `graph` here, never a re-read of wiringPath(outDir):
  // `writeGraph` strips `body_text` from what it serializes (dead weight once
  // this sidecar exists), so the nodes on disk no longer carry it — only this
  // in-memory object, still holding what `extractFile` populated, does.
  try {
    writeAskIndex(outDir, graph);
  } catch (err) {
    errors.push(`ask-index: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Tier-2 passive surface: project the nodes into per-file markdown cards, and
  // refresh the INDEX roster. Pure projection — no LLM, no network.
  const cardStats = writeCards(graph, outDir);
  writeIndex(outDir, cardStats.files);
  // Backfill concept nodes with their `covers:` symbol/file:line list (the
  // OKF↔Wiring link). No-op when there are no concept nodes (a $0 build).
  writeCovers(graph, outDir);

  const byKind = {} as Record<Kind, number>;
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byRelation = {} as Record<Relation, number>;
  for (const e of edges) byRelation[e.relation] = (byRelation[e.relation] ?? 0) + 1;

  return {
    contextDir: outDir,
    graphPath,
    cards: cardStats.written,
    files: files.length,
    nodes: nodes.length,
    edges: edges.length,
    byKind,
    byRelation,
    languages: [...langs].sort(),
    meaning,
    errors,
  };
}
