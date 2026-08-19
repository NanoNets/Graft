/**
 * Blast radius of a diff: what else in the repo depends on the lines this change
 * touched.
 *
 * The whole command is a join between two things graft already has — git's changed
 * line ranges (`diff.ts`) and the wiring graph's incoming edges (`traverse.ts`) —
 * so there is no new graph logic here, only the seeding rule:
 *
 *   changed line → the innermost symbol whose span contains it → seed
 *
 * Seeding by SYMBOL rather than by file is what makes the answer worth reading: a
 * 400-line file with a one-line edit reports the dependents of that one function,
 * not of everything the file happens to define. The file node is seeded too, so
 * importers (whose edge targets the file, not the symbol) are still found.
 */
import { impactOfMany, type EdgeHit } from "../graph/traverse.js";
import type { GraphV1, NodeV1 } from "../graph/types.js";
import { moduleIndex, type ModuleIndex } from "./modules.js";
import type { ChangedFile } from "./diff.js";

const SPAN_RE = /^L(\d+)-L(\d+)$/;

export interface BlastOptions {
  /** BFS depth over incoming edges; `Infinity` for the full closure. */
  depth: number;
  /** Concept/directory labels. Built from the context dir when omitted. */
  modules?: ModuleIndex;
}

/** A changed symbol the walk started from. */
export interface Seed {
  id: string;
  name: string;
  kind: string;
  path: string;
  span: string;
  /** True for a whole-file seed (an added file, or a change outside any symbol). */
  wholeFile: boolean;
}

/** One dependent symbol, and how the walk reached it. */
export interface Impacted {
  id: string;
  name: string;
  kind: string;
  path: string;
  span: string;
  relation: string;
  depth: number;
}

/** Dependents grouped for the diagram: the unit a reviewer actually thinks in. */
export interface ImpactedModule {
  label: string;
  files: string[];
  symbols: Impacted[];
  /** Changed files whose edges reached this module — the diagram's arrows. */
  from: string[];
}

export interface BlastReport {
  basis: string;
  depth: number;
  changed: ChangedFile[];
  /** Changed paths the graph has no node for: unsupported language, or deleted. */
  unindexed: string[];
  /** Changed paths that were deleted, called out because their dependents are
   * unknowable from a graph built at the post-change commit. */
  deleted: string[];
  seeds: Seed[];
  impacted: Impacted[];
  modules: ImpactedModule[];
}

function spanBounds(span: string): { start: number; end: number } | null {
  const m = SPAN_RE.exec(span);
  return m ? { start: Number(m[1]), end: Number(m[2]) } : null;
}

/**
 * The innermost symbols whose spans overlap any changed range in `path`.
 *
 * "Innermost" matters for a method: a changed line inside `Cache.get` overlaps both
 * the class span and the method span, and seeding the class would report everyone
 * who touches any part of `Cache`. Nesting is resolved by keeping, for each range,
 * only symbols that contain no other matched symbol.
 */
function seedsForFile(graph: GraphV1, path: string, ranges: { start: number; end: number }[]): NodeV1[] {
  const symbols: { node: NodeV1; start: number; end: number }[] = [];
  for (const n of graph.nodes) {
    if (n.kind === "file" || n.path !== path) continue;
    const b = spanBounds(n.span);
    if (b) symbols.push({ node: n, ...b });
  }
  if (symbols.length === 0) return [];

  const hit = new Map<string, NodeV1>();
  for (const r of ranges) {
    const overlapping = symbols.filter((s) => s.start <= r.end && s.end >= r.start);
    // Drop any symbol that strictly contains another overlapping one (the class
    // around a changed method), keeping the tightest description of the edit.
    for (const s of overlapping) {
      const containsAnother = overlapping.some(
        (o) => o !== s && o.start >= s.start && o.end <= s.end,
      );
      if (!containsAnother) hit.set(s.node.id, s.node);
    }
  }
  return [...hit.values()];
}

/** Compute the blast radius of `changed` against `graph`. */
export function blastRadius(
  graph: GraphV1,
  changed: ChangedFile[],
  basis: string,
  opts: BlastOptions,
): BlastReport {
  const fileNodes = new Map<string, NodeV1>();
  for (const n of graph.nodes) if (n.kind === "file") fileNodes.set(n.path, n);

  const seeds: Seed[] = [];
  const unindexed: string[] = [];
  const deleted: string[] = [];
  /** Merged dependents, keyed by node id, at the shallowest depth any file reached
   * them — plus which changed files did the reaching. */
  const merged = new Map<string, { hit: Impacted; from: Set<string> }>();

  for (const file of changed) {
    if (file.status === "deleted") {
      deleted.push(file.path);
      continue;
    }
    const fileNode = fileNodes.get(file.path);
    if (!fileNode) {
      unindexed.push(file.path);
      continue;
    }

    // No hunk ranges (a rename with no content change, a mode change) or an added
    // file: the unit of change is the file itself.
    const symbolSeeds = file.ranges.length > 0 ? seedsForFile(graph, file.path, file.ranges) : [];
    for (const node of symbolSeeds) {
      seeds.push({ id: node.id, name: node.name, kind: node.kind, path: node.path, span: node.span, wholeFile: false });
    }
    if (symbolSeeds.length === 0) {
      seeds.push({
        id: fileNode.id, name: fileNode.name, kind: fileNode.kind,
        path: fileNode.path, span: fileNode.span, wholeFile: true,
      });
    }

    // One walk PER CHANGED FILE, not one walk over every seed at once. A combined
    // walk records the depth a node was first reached at but not by which seed, so
    // the diagram could only draw "every changed file reaches every module" — a
    // cross-product that tells a reviewer nothing. Walking per file costs one
    // adjacency build each (cheap: the graph is already in memory) and buys arrows
    // that are true.
    //
    // The FILE node is a seed only when no symbol matched. `imports` edges target
    // the file id, so seeding it alongside symbols would pull in every importer of
    // the file — a one-line edit to one function would report every module that
    // imports the module, which is the noise this command exists to avoid. With no
    // symbol seeds (a change to a top-level constant, a new import, a file with no
    // extracted symbols) the file IS the unit of change, and its importers are the
    // only dependents there are.
    const walkSeeds = symbolSeeds.length > 0 ? symbolSeeds : [fileNode];
    const hits = impactOfMany(graph, walkSeeds, opts.depth, "in");
    for (const h of hits) {
      if (!hasNode(h)) continue;
      const hit = toImpacted(h);
      const prev = merged.get(hit.id);
      if (!prev) merged.set(hit.id, { hit, from: new Set([file.path]) });
      else {
        prev.from.add(file.path);
        // Keep the shallowest reach: a symbol two hops from one changed file and one
        // hop from another is one hop away from this PR.
        if (hit.depth < prev.hit.depth) prev.hit = hit;
      }
    }
  }

  const impacted = [...merged.values()].map((m) => m.hit);
  const origins = new Map([...merged].map(([id, m]) => [id, m.from]));

  return {
    basis,
    depth: opts.depth,
    changed,
    unindexed,
    deleted,
    seeds,
    impacted,
    modules: groupByModule(impacted, changed, origins, opts.modules ?? emptyIndex()),
  };
}

/** Convenience wrapper: build the module index from a context dir. */
export function blastRadiusIn(
  graph: GraphV1,
  contextDir: string,
  changed: ChangedFile[],
  basis: string,
  depth: number,
): BlastReport {
  return blastRadius(graph, changed, basis, { depth, modules: moduleIndex(contextDir) });
}

function hasNode(h: EdgeHit): h is EdgeHit & { node: NodeV1 } {
  // Unresolved endpoints (an import module string no node exists for) carry no
  // location, so they can neither be grouped nor opened — dropped rather than
  // rendered as a box with no file behind it.
  return h.node !== null;
}

function toImpacted(h: EdgeHit & { node: NodeV1 }): Impacted {
  return {
    id: h.node.id, name: h.node.name, kind: h.node.kind,
    path: h.node.path, span: h.node.span, relation: h.relation, depth: h.depth,
  };
}

function emptyIndex(): ModuleIndex {
  return { hasConcepts: false, labelOf: (p) => p };
}

/**
 * Group dependents into modules. `origins` carries, per dependent, the changed
 * files whose walk actually reached it — so a module's `from` is the real arrow
 * set, not every changed file in the PR.
 */
function groupByModule(
  impacted: Impacted[],
  changed: ChangedFile[],
  origins: Map<string, Set<string>>,
  modules: ModuleIndex,
): ImpactedModule[] {
  const changedPaths = new Set(changed.map((c) => c.path));
  const byLabel = new Map<string, ImpactedModule>();

  for (const hit of impacted) {
    // A dependent inside a file the PR already changes is not "reach" — it is the
    // diff. Reviewers see it in the diff itself; repeating it as blast radius is
    // what makes these comments feel like noise.
    if (changedPaths.has(hit.path)) continue;
    const label = modules.labelOf(hit.path);
    let mod = byLabel.get(label);
    if (!mod) {
      mod = { label, files: [], symbols: [], from: [] };
      byLabel.set(label, mod);
    }
    mod.symbols.push(hit);
    if (!mod.files.includes(hit.path)) mod.files.push(hit.path);
  }

  for (const mod of byLabel.values()) {
    const from = new Set<string>();
    for (const s of mod.symbols) for (const p of origins.get(s.id) ?? []) from.add(p);
    mod.from = [...from].sort();
    mod.files.sort();
    mod.symbols.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  }

  // Biggest first, but test-only modules last however large they are: "your own
  // tests reference the thing you changed" is expected, and on a repo with a test
  // per module it otherwise outranks every module a reviewer needs to see.
  return [...byLabel.values()].sort(
    (a, b) =>
      Number(isTestOnly(a)) - Number(isTestOnly(b)) ||
      b.symbols.length - a.symbols.length ||
      a.label.localeCompare(b.label),
  );
}

const TEST_PATH = /(^|\/)(tests?|specs?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$/i;

/** True when every file in the module is a test file. */
function isTestOnly(mod: ImpactedModule): boolean {
  return mod.files.length > 0 && mod.files.every((f) => TEST_PATH.test(f));
}
