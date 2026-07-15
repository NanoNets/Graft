/**
 * Data layer: fetches both graphs from the graft viz server and carries the
 * edge semantics (verb → family → form) defined in the design spec.
 */

export interface VizNode {
  id: string;
  name: string;
  type: string;
  summary: string;
  sources: string[];
}

export interface VizEdge {
  source: string;
  target: string;
  relation: string;
  description?: string;
  confidence?: "extracted" | "inferred";
}

export interface VizGraph {
  meta: { repoName?: string; nodeCount: number; edgeCount: number; skippedFiles?: number; droppedEdges?: number };
  nodes: VizNode[];
  edges: VizEdge[];
}

/** Every relation verb belongs to one family; form follows family. */
export type Family = "structure" | "dependency" | "contract" | "association";

const FAMILY: Record<string, Family> = {
  part_of: "structure", contains: "structure",
  uses: "dependency", depends_on: "dependency", calls: "dependency", imports: "dependency",
  produces: "dependency", configures: "dependency", validates: "dependency",
  extends: "contract", implements: "contract",
  references: "association",
};

export function famOf(rel: string): Family {
  return FAMILY[rel] ?? "association";
}

/** Force-spring rest length per family: hierarchy pulls tight. */
export const REST: Record<Family, number> = { structure: 85, dependency: 145, contract: 150, association: 185 };

/** Chip grouping: "part of" and "uses" are clear as groups; other verbs stand alone. */
export function chipKey(rel: string): string {
  if (famOf(rel) === "structure") return "part of";
  if (rel === "calls" || rel === "uses" || rel === "depends_on" || rel === "imports") return "uses";
  return rel.replace(/_/g, " ");
}

/** Hover hint: the question the verb answers for someone building or reviewing code. */
export const CHIP_HINT: Record<string, string> = {
  "part of": "where does this live? (contains, part of)",
  "uses": "what breaks if the target changes? (calls, uses, depends on, imports)",
  "produces": "where does this output come from?",
  "configures": "what changes its behavior without a code change?",
  "validates": "what checks or judges this? (tests, drift checks, scoring)",
  "extends": "what contract must this honor? (inheritance)",
  "implements": "what contract must this honor? (interface)",
  "references": "mentioned but never called — possible dead coupling",
};

/** Node-type → CSS custom property, per tab. */
const CONTEXT_COLORS: Record<string, string> = { system: "--sys", concept: "--con", file: "--fil", api: "--api" };
const CODE_COLORS: Record<string, string> = {
  file: "--k-file", class: "--k-class", function: "--k-fn", method: "--k-method",
  interface: "--k-iface", type: "--k-type", enum: "--k-enum",
};

export function colorToken(tab: "context" | "code", type: string): string {
  const m = tab === "code" ? CODE_COLORS : CONTEXT_COLORS;
  return m[type] ?? "--edge";
}

export function cvar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export async function loadContextGraph(): Promise<VizGraph> {
  const res = await fetch("/api/context-graph");
  return (await res.json()) as VizGraph;
}

interface CodeGraphV1 {
  meta: { version: number; nodeCount: number; edgeCount: number };
  nodes: Array<{
    id: string; name: string; kind: string; path: string; span: string;
    signature: string | null; summary: string | null; crux: { code: string; span: string } | null;
  }>;
  edges: Array<{ source: string; target: string; relation: string; confidence: "extracted" | "inferred" }>;
}

/** Fetch graph.json and reshape it into the viewer's graph form (null if absent). */
export async function loadCodeGraph(): Promise<VizGraph | null> {
  const res = await fetch("/api/code-graph");
  if (!res.ok) return null;
  const raw = (await res.json()) as CodeGraphV1;
  const nodes: VizNode[] = raw.nodes.map((n) => ({
    id: n.id,
    name: n.name,
    type: n.kind,
    summary: n.summary ?? n.signature ?? "",
    sources: [`${n.path} · ${n.span}`],
  }));
  const known = new Set(nodes.map((n) => n.id));
  // imports edges may point at unresolved module strings — drop those for rendering
  const edges: VizEdge[] = raw.edges
    .filter((e) => known.has(e.source) && known.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, relation: e.relation, confidence: e.confidence }));
  return { meta: { nodeCount: nodes.length, edgeCount: edges.length }, nodes, edges };
}

/** Subscribe to the server's live-reload channel. */
export function onServerChange(handler: () => void): void {
  const source = new EventSource("/events");
  source.onmessage = (ev) => {
    if (ev.data === "change") handler();
  };
}
