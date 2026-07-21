/**
 * Marker-fenced section upsert. Graft owns exactly the region between the
 * markers; everything else in the file belongs to the user and is preserved.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const START = '<!-- graft:start -->';
export const END = '<!-- graft:end -->';

export type UpsertAction = 'created' | 'appended' | 'replaced' | 'unchanged';

type LineEnding = '\n' | '\r\n';

export function fencedBlock(body: string, eol: LineEnding = '\n'): string {
  const block = `${START}\n${body.replace(/\s+$/, '')}\n${END}`;
  return eol === '\n' ? block : block.replace(/\n/g, '\r\n');
}

/** The file's dominant line ending: CRLF if any '\r\n' is present, else LF. */
function detectEol(text: string): LineEnding {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Index of a marker that sits alone on its own line, or -1. */
function markerLineIndex(lines: string[], marker: string, from = 0): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].trim() === marker) return i;
  }
  return -1;
}

export function upsertSection(filePath: string, body: string): { action: UpsertAction } {
  if (!existsSync(filePath)) {
    const block = fencedBlock(body);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${block}\n`);
    return { action: 'created' };
  }
  const text = readFileSync(filePath, 'utf8');
  const eol = detectEol(text);
  const block = fencedBlock(body, eol);
  const lines = text.split('\n');
  const s = markerLineIndex(lines, START);
  const e = s === -1 ? -1 : markerLineIndex(lines, END, s + 1);
  if (s !== -1 && e !== -1) {
    const current = lines.slice(s, e + 1).join('\n');
    if (current.replace(/\r/g, '') === block.replace(/\r/g, '')) return { action: 'unchanged' };
    const next = [...lines.slice(0, s), ...block.split('\n'), ...lines.slice(e + 1)];
    writeFileSync(filePath, next.join('\n'));
    return { action: 'replaced' };
  }
  const doubleEol = eol + eol;
  const sep = text.endsWith(doubleEol) ? '' : text.endsWith(eol) ? eol : doubleEol;
  writeFileSync(filePath, `${text}${sep}${block}${eol}`);
  return { action: 'appended' };
}
