/**
 * The three MCP tools, as pure functions over the existing engine.
 * `callTool` never throws — hosts get soft errors as isError content.
 */
import { Graft } from '../engine.js';
import { formatAsk } from '../ask/ask.js';
import { formatCheckReport } from '../context/check.js';
import { formatGraphCheckReport } from '../graph/check.js';
import { formatBlastRadius } from '../claude/format.js';
import { loadGraphCached } from '../graph/load.js';
import { contextDirFor } from '../context/node-file.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: object;
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
    description: 'List what depends on a file — who breaks if it changes.',
    inputSchema: {
      type: 'object',
      properties: { file: { type: 'string', description: 'repo-relative path, e.g. src/cache.ts' } },
      required: ['file'],
    },
  },
];

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
        const file = String(args.file ?? '');
        if (!file) return { text: 'graft_blast_radius requires a file', isError: true };
        const w = loadGraphCached(contextDirFor(root));
        if (!w) return { text: 'no graph found — run `graft build` first', isError: true };
        const br = formatBlastRadius(w, file);
        return { text: br ?? `no known dependents of ${file}`, isError: false };
      }
      default:
        return { text: `unknown tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { text: err instanceof Error ? err.message : String(err), isError: true };
  }
}
