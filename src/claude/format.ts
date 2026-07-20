import { basename } from 'node:path';
import type { Stats, SessionState } from './state.js';
import type { GraphV1, EdgeV1 } from '../graph/types.js';

const C = {
  indigo: (s: string) => `\x1b[38;2;84;111;255m${s}\x1b[0m`,
  amber: (s: string) => `\x1b[38;2;224;165;68m${s}\x1b[0m`,
  muted: (s: string) => `\x1b[38;5;244m${s}\x1b[0m`,
  text: (s: string) => `\x1b[38;5;251m${s}\x1b[0m`,
};
const SEP = C.muted(' · ');

export function enrichedSegment(s: Stats): string | null {
  if (s.readyCount < 1) return null;
  const pct = s.totalCount ? Math.round((s.readyCount / s.totalCount) * 100) : 0;
  return C.indigo(`${pct}% enriched`);
}

export function freshnessSegment(s: Stats): string {
  if (s.syncing) return C.amber('syncing…');
  if (s.dirty && s.staleCount > 0) return C.amber(`⚠ ${s.staleCount} stale`);
  if (s.dirty) return C.amber('⚠ stale');
  return C.indigo('✓ synced');
}

export function renderStatusline(
  stats: Stats | null,
  _session: SessionState | null,
  ctx: { ctxPct: number | null },
): string[] {
  if (!stats || stats.nodeCount === 0) {
    return [C.muted('◤ graft · not built · run ') + C.text('graft build')];
  }
  const top = [C.muted('◤ ') + C.indigo('graft'), C.text(`${stats.nodeCount} nodes / ${stats.edgeCount} edges`)];
  const enr = enrichedSegment(stats);
  if (enr) top.push(enr);
  top.push(freshnessSegment(stats));

  const bottom: string[] = [];
  if (typeof ctx.ctxPct === 'number') bottom.push(C.text(`ctx ${ctx.ctxPct}%`));
  if (stats.lastFile) bottom.push(C.muted('last: ') + C.text(basename(stats.lastFile)));

  const lines = [top.join(SEP)];
  if (bottom.length) lines.push(C.muted('▸ ') + bottom.join(SEP));
  return lines;
}

function nodeIdsInFile(w: GraphV1, filePath: string): Set<string> {
  const nodes = w.nodes ?? [];
  return new Set(
    nodes.filter((n) => n.path && (filePath === n.path || filePath.endsWith(`/${n.path}`) || filePath.endsWith(n.path)))
      .map((n) => n.id),
  );
}

export function incomingEdges(w: GraphV1, filePath: string): EdgeV1[] {
  const ids = nodeIdsInFile(w, filePath);
  if (!ids.size) return [];
  return (w.edges ?? []).filter((e) => ids.has(e.target) && !ids.has(e.source));
}

export function formatBlastRadius(w: GraphV1, filePath: string, cap = 8): string | null {
  const edges = incomingEdges(w, filePath);
  if (!edges.length) return null;
  const byId = new Map((w.nodes ?? []).map((n) => [n.id, n]));
  const items = edges.slice(0, cap).map((e) => {
    const n = byId.get(e.source);
    const label = n ? `${n.name} (${basename(n.path)})` : e.source;
    return ` • ${e.relation} ← ${label}`;
  });
  const more = edges.length > cap ? `\n • +${edges.length - cap} more` : '';
  return `[graft] blast radius for ${basename(filePath)} — who depends on it:\n${items.join('\n')}${more}`;
}

export interface AskJson {
  query: string; mode: string;
  hits: { kind: string; title: string; pointer: string; snippet: string; score: number }[];
}

export function formatRetrieval(ask: AskJson, cap = 5): string | null {
  const hits = (ask.hits ?? []).slice(0, cap);
  if (!hits.length) return null;
  const lines = hits.map((h) => {
    const ptr = (h.pointer ?? '').split(',')[0].trim();
    const snip = (h.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
    return ` • ${h.title} — ${ptr} — ${snip}`;
  });
  return `[graft] relevant context for this prompt:\n${lines.join('\n')}`;
}

export function formatOrientation(indexMd: string, budgetBytes = 1500): string {
  return `[graft] repo map (graft/INDEX.md):\n${indexMd.slice(0, budgetBytes)}`;
}
