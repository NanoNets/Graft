/**
 * CLI wiring for `graft callers` / `callees` / `impact`.
 *
 * The three commands are one implementation with a direction flag: they all
 * resolve a symbol via `resolveSymbol`, walk edges via `callersOf` /
 * `calleesOf` / `impactOf`, and share the same resolve-or-die flow, human
 * formatter, and --json shape. Kept out of cli.ts so that file stays thin
 * (argument wiring only) and this logic stays unit-testable without shelling
 * out to the CLI on every case.
 */
import { resolve } from "node:path";
import { contextDirFor } from "../context/node-file.js";
import { loadGraphCached } from "./load.js";
import { resolveSymbol, callersOf, calleesOf, impactOf, type EdgeHit } from "./traverse.js";
import type { GraphV1, NodeV1 } from "./types.js";

export type TraverseKind = "callers" | "callees" | "impact";

export interface TraverseCliOptions {
  in?: string;
  json?: boolean;
  /** impact only: max BFS depth, as the raw --depth string (validated here). */
  depth?: string;
  /** the top-level `--dir` override, so this command respects it like every other. */
  globalDir?: string;
}

const ARROW: Record<TraverseKind, "←" | "→"> = { callers: "←", impact: "←", callees: "→" };
const DEFAULT_IMPACT_DEPTH = 2;

function edgesFor(kind: TraverseKind, graph: GraphV1, node: NodeV1, depth: number): EdgeHit[] {
  if (kind === "callers") return callersOf(graph, node);
  if (kind === "callees") return calleesOf(graph, node);
  return impactOf(graph, node, depth);
}

/** Exported so the MCP tools (`graft_callers`/`graft_callees`/`graft_blast_radius`
 * in `src/mcp/tools.ts`) can render the same human report format as the CLI,
 * rather than re-implementing it — both surfaces walk the same edges via the
 * same `resolveSymbol`/`callersOf`/`calleesOf`/`impactOf` core. */
export function headerOf(n: NodeV1): string {
  return `${n.name} · ${n.kind} · ${n.path}:${n.span}`;
}

export function hitLine(kind: TraverseKind, hit: EdgeHit): string {
  const arrow = ARROW[kind];
  const depthTag = kind === "impact" ? ` [depth ${hit.depth}]` : "";
  const label = hit.node ? `${hit.node.name} (${hit.node.path}:${hit.node.span})` : `${hit.id} (unresolved import)`;
  return `  ${hit.relation} ${arrow} ${label}${depthTag}`;
}

/** Loud, actionable empty-result note — never a bare empty list. `callers` and
 * `impact` both walk incoming edges, so they share the "callers" wording. */
export function looseNoteFor(kind: TraverseKind, name: string): string {
  const label = kind === "callees" ? "callees" : "callers";
  const direction = kind === "callees" ? "outgoing" : "incoming";
  return `  no indexed ${label} — the graph has no ${direction} call/reference edges for this symbol; try grep -rn "${name}"`;
}

interface SymbolJson {
  id: string;
  name: string;
  kind: string;
  path: string;
  span: string;
}

interface MatchJson {
  symbol: SymbolJson;
  hits: HitJson[];
  note?: string;
}

interface HitJson {
  id: string;
  name?: string;
  kind?: string;
  path?: string;
  span?: string;
  relation: string;
  depth: number;
}

function symbolJson(n: NodeV1): SymbolJson {
  return { id: n.id, name: n.name, kind: n.kind, path: n.path, span: n.span };
}

function hitJson(hit: EdgeHit): HitJson {
  const out: HitJson = { id: hit.id, relation: hit.relation, depth: hit.depth };
  if (hit.node) {
    out.name = hit.node.name;
    out.kind = hit.node.kind;
    out.path = hit.node.path;
    out.span = hit.node.span;
  }
  return out;
}

/**
 * Resolve `query` in the graph at `dir` (respecting `--dir`/`--in`), walk
 * edges per `kind`, and print either the human report or `--json`. Exits the
 * process (code 1) when there's no graph at all or the symbol is unknown —
 * both are caller-facing mistakes, not recoverable states.
 */
export function runTraverseCommand(kind: TraverseKind, query: string, dir: string, opts: TraverseCliOptions): void {
  const root = resolve(dir);
  const contextDir = contextDirFor(root, opts.globalDir);
  const graph = loadGraphCached(contextDir);
  if (!graph) {
    console.error(`✗ no graph found at ${contextDir} — run \`graft build\` first`);
    process.exit(1);
  }

  const matches = resolveSymbol(graph, query, opts.in ? { in: opts.in } : {});
  if (matches.length === 0) {
    console.error(`✗ no symbol "${query}" in the graph — check spelling or run graft build`);
    process.exit(1);
  }

  let depth = DEFAULT_IMPACT_DEPTH;
  if (kind === "impact" && opts.depth !== undefined) {
    const d = Number(opts.depth);
    if (!Number.isFinite(d) || d < 1) {
      console.error(`✗ --depth must be a positive number, got "${opts.depth}"`);
      process.exit(1);
    }
    depth = d;
  }

  const results = matches.map((symbol) => ({ symbol, hits: edgesFor(kind, graph, symbol, depth) }));

  if (opts.json) {
    const payload = {
      query,
      matches: results.map((r): MatchJson => {
        const m: MatchJson = { symbol: symbolJson(r.symbol), hits: r.hits.map(hitJson) };
        if (r.hits.length === 0) {
          m.note = looseNoteFor(kind, r.symbol.name);
        }
        return m;
      }),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const lines: string[] = [];
  for (const { symbol, hits } of results) {
    lines.push(headerOf(symbol));
    if (hits.length === 0) lines.push(looseNoteFor(kind, symbol.name));
    else for (const h of hits) lines.push(hitLine(kind, h));
    lines.push("");
  }
  process.stdout.write(lines.join("\n").replace(/\n+$/, "\n"));
}
