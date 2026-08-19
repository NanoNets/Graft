/**
 * Module labels for the blast diagram — the "what part of the system is this?"
 * layer, so a reviewer reads `Graph Extraction and Loading` instead of eleven
 * file paths.
 *
 * Two sources, best first:
 *   1. the deep tier's concept nodes (`graft/*.md`), whose frontmatter lists the
 *      source files each concept was synthesized from. This is why `blast` is
 *      worth running on a `build --deep` graph: the grouping is the product.
 *   2. the file's directory, when no concept claims it (a breadth-tier graph, or
 *      a file added by this very PR and therefore absent from the concept layer).
 */
import { readNodes } from "../context/node-file.js";

export interface ModuleIndex {
  /** Label for a repo-relative path — a concept name when one claims the file. */
  labelOf(path: string): string;
  /** True when at least one concept node was read (i.e. a --deep graph). */
  hasConcepts: boolean;
}

/**
 * Build the path → module-label lookup for a context dir.
 *
 * A file can be cited by several concepts; the SMALLEST claiming concept wins.
 * A concept grounded in three files says something specific about those three,
 * while a forty-file concept is closer to "the codebase" — picking the tighter
 * one keeps the diagram's boxes meaningful.
 */
export function moduleIndex(contextDir: string): ModuleIndex {
  const claims = new Map<string, { label: string; size: number }>();
  const nodes = readNodes(contextDir);
  for (const node of nodes) {
    if (!node.name) continue;
    for (const src of node.sources) {
      const prev = claims.get(src.path);
      if (!prev || node.sources.length < prev.size) {
        claims.set(src.path, { label: node.name, size: node.sources.length });
      }
    }
  }
  return {
    hasConcepts: nodes.length > 0,
    labelOf: (path: string) => shortLabel(claims.get(path)?.label ?? dirLabel(path)),
  };
}

/** Longest label a circle in the diagram can hold before the text overruns it. */
const MAX_LABEL = 30;

/**
 * A concept name trimmed to fit a node.
 *
 * Concept names are written for a reader with the whole file in front of them, so
 * they run long and some carry a `Concept: ` prefix from the synthesis prompt.
 * "Reciprocal-Rank Fusion for Workspace Federation" is a fine node title in `graft
 * viz` and unreadable inside a circle, so it is cut at a word boundary — never
 * mid-word, which reads as data corruption rather than as a trim.
 */
export function shortLabel(label: string): string {
  const bare = label.replace(/^concepts?:\s*/i, "").trim();
  if (bare.length <= MAX_LABEL) return bare;
  const cut = bare.lastIndexOf(" ", MAX_LABEL);
  return `${bare.slice(0, cut > MAX_LABEL / 2 ? cut : MAX_LABEL).trimEnd()}…`;
}

/** Fallback label: the file's directory, or `(root)` for a top-level file. */
export function dirLabel(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "(root)" : path.slice(0, cut) + "/";
}
