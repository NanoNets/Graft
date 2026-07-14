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
import { join, relative, resolve } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { contextDirFor } from "../context/node-file.js";
import { extractFile, languageOf, type Language, type RawEdge } from "./extract.js";
import { resolveEdges } from "./resolve.js";
import { enrichGraph, type EnrichStats } from "./enrich.js";
import { GRAPH_FILE, readGraph, writeGraph } from "./write.js";
import type { GraphV1, Kind, NodeV1, Relation } from "./types.js";
import type { CruxSummarizer } from "../ai/crux.js";

export interface GraphBuildOptions {
  /** Override the output dir (default: `<root>/.context`). */
  contextDir?: string;
  /** Run the Tier-2 LLM meaning pass. Absent → Tier-1 only (cache is still preserved). */
  summarizer?: CruxSummarizer;
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

  const edges = resolveEdges(nodes, rawEdges);

  // graph.json is its own Tier-2 cache: fold in the prior meaning layer so an
  // unchanged body is never re-summarized (and a Tier-1-only run never wipes it).
  const prior = readGraph(join(outDir, GRAPH_FILE));
  const priorById = new Map((prior?.nodes ?? []).map((n) => [n.id, n]));
  const meaning = await enrichGraph(nodes, priorById, sources, {
    summarizer: opts.summarizer,
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

  const byKind = {} as Record<Kind, number>;
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byRelation = {} as Record<Relation, number>;
  for (const e of edges) byRelation[e.relation] = (byRelation[e.relation] ?? 0) + 1;

  return {
    contextDir: outDir,
    graphPath,
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

export { GRAPH_FILE };
