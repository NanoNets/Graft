/**
 * Marker-fenced section upsert. Graft owns exactly the region between the
 * markers; everything else in the file belongs to the user and is preserved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const START = '<!-- graft:start -->';
export const END = '<!-- graft:end -->';

export type UpsertAction = 'created' | 'appended' | 'replaced' | 'unchanged';

export function fencedBlock(body: string): string {
  return `${START}\n${body.replace(/\s+$/, '')}\n${END}`;
}

/** Index of a marker that sits alone on its own line, or -1. */
function markerLineIndex(lines: string[], marker: string, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === marker) return i;
  }
  return -1;
}

export function upsertSection(filePath: string, body: string): { action: UpsertAction } {
  const block = fencedBlock(body);
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${block}\n`);
    return { action: 'created' };
  }
  const text = readFileSync(filePath, 'utf8');
  const lines = text.split('\n');
  const s = markerLineIndex(lines, START);
  const e = s === -1 ? -1 : markerLineIndex(lines, END, s + 1);
  if (s !== -1 && e !== -1) {
    const current = lines.slice(s, e + 1).join('\n');
    if (current === block) return { action: 'unchanged' };
    const next = [...lines.slice(0, s), ...block.split('\n'), ...lines.slice(e + 1)];
    writeFileSync(filePath, next.join('\n'));
    return { action: 'replaced' };
  }
  const sep = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(filePath, `${text}${sep}${block}\n`);
  return { action: 'appended' };
}
