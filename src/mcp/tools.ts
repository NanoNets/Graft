/**
 * The MCP tools, as pure functions over the existing engine.
 * `callTool` never throws — hosts get soft errors as isError content.
 */
import { Graft } from '../engine.js';
import { formatAsk } from '../ask/ask.js';
import { formatCheckReport } from '../context/check.js';
import { formatGraphCheckReport } from '../graph/check.js';
import { loadGraphCached } from '../graph/load.js';
import { contextDirFor } from '../context/node-file.js';
import { resolveSymbol, callersOf, calleesOf, impactOf, impactOfFile, type EdgeHit } from '../graph/traverse.js';
import { headerOf, hitLine, looseNoteFor, type TraverseKind } from '../graph/traverse-cli.js';
import type { NodeV1 } from '../graph/types.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
}

/** Default BFS depth for `graft_blast_radius`, same default as `graft impact`. */
const DEFAULT_BLAST_DEPTH = 2;

const NO_GRAPH = 'no graph found — run `graft build` first';

function unknownSymbolText(query: string): string {
  return `no symbol "${query}" in the graph — check spelling or run \`graft build\``;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'graft_ask',
    description:
      'Query the repo context graph in plain words. Returns ranked nodes with exact file:line spans and the relevant source inlined — usually the full answer, no file reads needed.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what you want to understand, in plain words' },
        limit: { type: 'number', description: 'max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'graft_check',
    description: 'Report whether the committed graph is in sync with the code (drift check).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'graft_blast_radius',
    description:
      'BFS over incoming call/reference/import/implements/extends edges from a file or symbol — who breaks if it changes ($0, no LLM).',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'repo-relative file path, or a symbol name (bare, qualified, or package-qualified)' },
        symbol: { type: 'string', description: 'alternative to `file` — a symbol name (bare, qualified, or package-qualified)' },
        depth: { type: 'number', description: 'max BFS depth (default 2)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'graft_callers',
    description: 'Who calls/references/imports/implements/extends a symbol (depth 1, $0, no LLM).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'bare name, qualified (Class.method), or package-qualified (pkg.Fn)' },
        in: { type: 'string', description: 'narrow matches to nodes whose path contains this substring' },
      },
      required: ['symbol'],
    },
  },
  {
    name: 'graft_callees',
    description: 'What a symbol calls/references/imports/implements/extends (depth 1, $0, no LLM).',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'bare name, qualified (Class.method), or package-qualified (pkg.Fn)' },
        in: { type: 'string', description: 'narrow matches to nodes whose path contains this substring' },
      },
      required: ['symbol'],
    },
  },
];

/** Render every resolved match's header + edge report (or the loud zero-edge
 * note), one block per match, joined with a blank line — the same grouping
 * `graft callers`/`callees`/`impact` use for multi-match symbols. */
function renderMatches(kind: TraverseKind, matches: NodeV1[], hitsFor: (n: NodeV1) => EdgeHit[]): string {
  return matches
    .map((m) => {
      const hits = hitsFor(m);
      const lines = [headerOf(m)];
      if (hits.length === 0) lines.push(looseNoteFor(kind, m.name));
      else for (const h of hits) lines.push(hitLine(kind, h));
      return lines.join('\n');
    })
    .join('\n\n');
}

export function callTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): { text: string; isError: boolean } {
  try {
    switch (name) {
      case 'graft_ask': {
        const query = String(args.query ?? '');
        if (!query) return { text: 'graft_ask requires a query', isError: true };
        const limit = typeof args.limit === 'number' ? args.limit : 5;
        const engine = new Graft();
        const r = engine.ask(root, query, { limit, source: true });
        return { text: formatAsk(r), isError: false };
      }
      case 'graft_check': {
        const engine = new Graft();
        const r = engine.check(root);
        const g = engine.checkGraph(root);
        const parts = [formatCheckReport(r)];
        if (!g.missing) parts.push(formatGraphCheckReport(g));
        return { text: parts.join('\n\n'), isError: false };
      }
      case 'graft_blast_radius': {
        const query = String(args.symbol ?? args.file ?? '');
        if (!query) return { text: 'graft_blast_radius requires a file or symbol', isError: true };
        const w = loadGraphCached(contextDirFor(root));
        if (!w) return { text: NO_GRAPH, isError: true };
        const matches = resolveSymbol(w, query);
        if (matches.length === 0) return { text: unknownSymbolText(query), isError: true };
        const depth =
          typeof args.depth === 'number' && Number.isFinite(args.depth) && args.depth >= 1
            ? args.depth
            : DEFAULT_BLAST_DEPTH;
        // impactOf's BFS is over incoming edges — same wording family as "callers".
        // A file-kind match must aggregate impact over the file node AND every
        // symbol it defines: a `calls`/`references`/etc. edge into a function
        // defined in the file targets the SYMBOL id, never the FILE id, so
        // walking the file node alone silently drops dependents that call
        // into it rather than merely importing it. Symbol-kind matches keep
        // the plain single-seed walk.
        const text = renderMatches('impact', matches, (m) =>
          m.kind === 'file' ? impactOfFile(w, m, depth) : impactOf(w, m, depth),
        );
        return { text, isError: false };
      }
      case 'graft_callers':
      case 'graft_callees': {
        const symbol = String(args.symbol ?? '');
        if (!symbol) return { text: `${name} requires a symbol`, isError: true };
        const w = loadGraphCached(contextDirFor(root));
        if (!w) return { text: NO_GRAPH, isError: true };
        const inOpt = typeof args.in === 'string' && args.in ? { in: args.in } : {};
        const matches = resolveSymbol(w, symbol, inOpt);
        if (matches.length === 0) return { text: unknownSymbolText(symbol), isError: true };
        const kind: TraverseKind = name === 'graft_callers' ? 'callers' : 'callees';
        const walk = kind === 'callers' ? callersOf : calleesOf;
        const text = renderMatches(kind, matches, (m) => walk(w, m));
        return { text, isError: false };
      }
      default:
        return { text: `unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}
