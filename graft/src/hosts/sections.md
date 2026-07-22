# src/hosts/sections.ts

- UpsertAction · type · L11-L11 — type UpsertAction = 'created' | 'appended' | 'replaced' | 'unchanged';
- LineEnding · type · L13-L13 — type LineEnding = '\n' | '\r\n';
- fencedBlock · function · L15-L21 — function fencedBlock(body: string, eol: LineEnding = '\n'): string
- detectEol · function · L24-L26 — function detectEol(text: string): LineEnding
- markerLineIndex · function · L29-L34 — function markerLineIndex(lines: string[], marker: string, from = 0): number
- upsertSection · function · L36-L67 — function upsertSection(filePath: string, body: string): { action: UpsertAction }
