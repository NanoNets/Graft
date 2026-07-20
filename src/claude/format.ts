import { basename } from 'node:path';
import type { Stats, SessionState } from './state.js';

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
