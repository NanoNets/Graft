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
  // Normalize any pre-existing '\r' out of the body first so callers passing
  // a CRLF (or stray-CR) body never get doubled '\r' when eol is '\r\n'.
  const normalizedBody = body.replace(/\r/g, '');
  const block = `${START}\n${normalizedBody.replace(/\s+$/, '')}\n${END}`;
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
  // Split on either eol so lines never carry an embedded '\r' — that keeps
  // the marker/content comparison clean and lets us rejoin deliberately with
  // the detected eol instead of relying on '\r' characters riding along
  // inside array elements (which broke down whenever the block-with-no-
  // trailing-'\r' element sat next to a '\n' join, e.g. right after END, or
  // when the block was the entire file).
  const lines = text.split(/\r\n|\n/);
  const s = markerLineIndex(lines, START);
  const e = s === -1 ? -1 : markerLineIndex(lines, END, s + 1);
  if (s !== -1 && e !== -1) {
    const current = lines.slice(s, e + 1).join('\n');
    if (current === fencedBlock(body)) return { action: 'unchanged' };
    const block = fencedBlock(body, eol);
    const next = [...lines.slice(0, s), ...block.split(eol), ...lines.slice(e + 1)];
    writeFileSync(filePath, next.join(eol));
    return { action: 'replaced' };
  }
  const block = fencedBlock(body, eol);
  const doubleEol = eol + eol;
  const sep = text.endsWith(doubleEol) ? '' : text.endsWith(eol) ? eol : doubleEol;
  writeFileSync(filePath, `${text}${sep}${block}${eol}`);
  return { action: 'appended' };
}
