/**
 * `graph` — build `.context/graph.json` from a code repository.
 *
 * M1 pipeline (Tier-1 only, deterministic, no LLM):
 *   1. Walk the repo for TS/Python source files.
 *   2. Parse each with tree-sitter and emit one NodeV1 per definition.
 *   3. Write a sorted graph.json.
 * Edges (M2) and LLM summary/crux (M3) layer onto this without changing it.
 *
 * Step 2 is memoized per file (`extract-cache.ts`): a file whose bytes haven't
 * moved replays its last parse instead of re-running tree-sitter, so a rebuild
 * costs ~the files that changed. Everything after extraction still runs over the
 * whole node set, so an incremental build's output is byte-identical to a cold
 * one — the invariant `test/graph-incremental.test.ts` pins down.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { walkDir } from "../ingest/fs.js";
import { contextDirFor, ensureGitignored } from "../context/node-file.js";
import { extractFile, languageOf, type Language, type RawEdge } from "./extract.js";
import { contentHash } from "../util/id.js";
import {
  emptyExtractCache,
  readExtractCache,
  writeExtractCache,
  type ExtractEntry,
} from "./extract-cache.js";
import { statUnchanged, writeFingerprint } from "./fingerprint.js";
import { listSourceStats } from "./source-files.js";
import { resolveEdges, type GoModule } from "./resolve.js";
import { enrichGraph, type EnrichStats } from "./enrich.js";
import { readGraph, writeGraph, wiringPath } from "./write.js";
import { writeCards, writeIndex, writeCovers } from "./cards.js";
import { writeAskIndex } from "../ask/index-file.js";
import { discoverScopes, scopeOf } from "./scopes.js";
import type { GraphV1, Kind, NodeV1, Relation, ScopeV1 } from "./types.js";
import type { CruxSummarizer } from "../ai/crux.js";

export { listSourceFiles } from "./source-files.js";

/** Minimum non-file node count for a discovered sub-scope to stand on its own
 * (over-split guard 3). A scope with fewer nodes than this is folded into the
 * root scope — node counts aren't known until after the graph is assembled,
 * so this runs here rather than in `discoverScopes`. */
const MIN_SCOPE_NODES = 5;

/** Guard 5: merge scopes with too few non-file nodes into the root scope, then
 * re-apply the canonical single-scope collapse (rule 6) if only root is left. */
function applyMinSubstanceGuard(scopes: ScopeV1[], nodes: NodeV1[]): ScopeV1[] {
  if (scopes.length <= 1) return scopes;
  const counts = new Map<string, number>();
  for (const scope of scopes) counts.set(scope.prefix, 0);
  for (const node of nodes) {
    if (node.kind === "file") continue;
    const scope = scopeOf(node.path, scopes);
    counts.set(scope.prefix, (counts.get(scope.prefix) ?? 0) + 1);
  }
  const kept = scopes.filter((s) => s.prefix === "" || (counts.get(s.prefix) ?? 0) >= MIN_SCOPE_NODES);
  if (kept.length === 0) return [{ prefix: "", label: "", markers: [] }];
  if (kept.length === 1 && kept[0].prefix === "") {
    return [{ prefix: "", label: "", markers: kept[0].markers }];
  }
  return kept;
}

export interface GraphBuildOptions {
  /** Override the output dir (default: `<root>/.context`). */
  contextDir?: string;
  /** Replay unchanged files from the extraction cache instead of re-parsing them
   * (default true). False forces a cold parse of the whole repo. */
  reuse?: boolean;
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
  /** Files re-parsed this run (the rest were replayed from the extraction cache). */
  parsed: number;
  /** Files replayed from the extraction cache. */
  reused: number;
  nodes: number;
  edges: number;
  byKind: Record<Kind, number>;
  byRelation: Record<Relation, number>;
  languages: string[];
  meaning: EnrichStats;
  errors: string[];
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
  const files = listSourceStats(root, outDir);
  const discoveredScopes = discoverScopes(root);

  const nodes: NodeV1[] = [];
  const rawEdges: RawEdge[] = [];
  const sources = new Map<string, string>();
  const langs = new Set<Language>();
  const errors: string[] = [];

  // Tier-1 memo: unchanged files replay their last parse. `entries` is rebuilt
  // from scratch each run and keyed only by files currently on disk, so deletions
  // fall out of both the cache and the fingerprint with no separate pruning pass.
  const priorExtract = opts.reuse === false ? emptyExtractCache() : readExtractCache(outDir);
  const entries: Record<string, ExtractEntry> = {};
  // The Tier-2 pass reads source text for any node it must summarize, including
  // one in a file we didn't re-parse — so when a summarizer is in play, read
  // every file. Reading is ~0.05ms/file; parsing is the ~4.6ms we're skipping.
  const needAllSources = !!opts.summarizer;
  let parsed = 0;
  let reused = 0;

  files.forEach((f, i) => {
    const rel = f.rel;
    opts.onProgress?.({ phase: "parse", index: i, total: files.length, file: rel });
    const lang = languageOf(f.abs)!;
    const cached = priorExtract.files[rel];
    // `statUnchanged` is shared with the freshness probe on purpose: whatever the
    // probe treats as "moved" must be something this loop will actually re-read,
    // or a query rebuilds forever and still answers from the old parse.
    const unchanged = !!cached && statUnchanged(cached, f);

    let source: string | null = null;
    if (!unchanged || needAllSources) {
      try {
        source = readFileSync(f.abs, "utf8");
      } catch (err) {
        const message = `${rel}: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(message);
        // Record it anyway (with the stat we do have) so the freshness probe's
        // fast path doesn't report this file as new on every single query.
        entries[rel] = { size: f.size, mtimeMs: f.mtimeMs, hash: "", nodes: [], rawEdges: [], error: message };
        return;
      }
    }

    // A stat mismatch is only a *suspicion*; confirm by bytes so a touch, or a
    // checkout that restores identical content, still replays the cache.
    const hash = source === null ? cached!.hash : contentHash(source);
    if (cached && hash === cached.hash) {
      entries[rel] = { ...cached, size: f.size, mtimeMs: f.mtimeMs };
      if (source !== null) sources.set(rel, source);
      reused++;
      if (cached.error) {
        errors.push(cached.error); // this file failed to parse last time too
        return;
      }
      nodes.push(...cached.nodes);
      rawEdges.push(...cached.rawEdges);
      langs.add(lang);
      return;
    }

    parsed++;
    try {
      const { nodes: fileNodes, rawEdges: fileEdges } = extractFile(rel, source!, lang);
      nodes.push(...fileNodes);
      rawEdges.push(...fileEdges);
      sources.set(rel, source!);
      langs.add(lang);
      entries[rel] = { size: f.size, mtimeMs: f.mtimeMs, hash, nodes: fileNodes, rawEdges: fileEdges };
    } catch (err) {
      const message = `${rel}: parse failed — ${err instanceof Error ? err.message : String(err)}`;
      errors.push(message);
      entries[rel] = { size: f.size, mtimeMs: f.mtimeMs, hash, nodes: [], rawEdges: [], error: message };
    }
  });

  // Persist the memo BEFORE enrichment, because `enrichGraph` mutates these very
  // node objects (summary/crux/summary_state) and the cache must only ever hold
  // pristine Tier-1 output — otherwise a replayed node would arrive pre-enriched
  // and a cold build and an incremental build could disagree. The meaning layer
  // has its own cache (wiring.json itself, keyed on body_hash); this one is
  // strictly about not re-parsing.
  writeExtractCache(outDir, {
    ...emptyExtractCache(),
    files: entries,
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

  // Guard 5 (minimum-substance): node counts aren't known until nodes are
  // assembled, so the merge-tiny-scopes-into-root guard runs here.
  const scopes = applyMinSubstanceGuard(discoveredScopes, nodes);

  const graph: GraphV1 = {
    meta: {
      version: 1,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      languages: [...langs].sort(),
      scopes,
    },
    nodes,
    edges,
  };

  const graphPath = writeGraph(graph, outDir);
  // The graph is a local, regenerable cache — make sure git ignores it. Runs on
  // every build (cheap, idempotent), so a fresh clone's first build self-ignores.
  ensureGitignored(root, outDir);
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

  // Dead last, and unconditionally. The fingerprint is the claim "everything graft
  // wrote describes exactly these bytes", so it may only be made once everything
  // graft writes is on disk: written before the cards above, a throw in that
  // projection would leave a half-written `graft/` marked permanently clean, and no
  // later probe would ever ask for it again. Conversely it must NOT depend on the
  // extract memo's write succeeding — a missing memo only makes the next rebuild
  // cold, whereas a missing fingerprint makes *every* query rebuild the repo from
  // scratch, forever. If this write itself fails, the next probe reports "unknown"
  // and rebuilds once, which is the safe direction.
  writeFingerprint(outDir, entries);

  const byKind = {} as Record<Kind, number>;
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] ?? 0) + 1;
  const byRelation = {} as Record<Relation, number>;
  for (const e of edges) byRelation[e.relation] = (byRelation[e.relation] ?? 0) + 1;

  return {
    contextDir: outDir,
    graphPath,
    cards: cardStats.written,
    files: files.length,
    parsed,
    reused,
    nodes: nodes.length,
    edges: edges.length,
    byKind,
    byRelation,
    languages: [...langs].sort(),
    meaning,
    errors,
  };
}
