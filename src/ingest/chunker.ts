/**
 * Split a document into overlapping chunks for embedding and extraction.
 *
 * The splitter is paragraph-aware: it accumulates whole paragraphs up to the
 * target size, and only hard-splits a paragraph that is larger than the target
 * on its own. Adjacent chunks share `overlap` characters so context that spans
 * a boundary is not lost.
 */
export function chunkText(
  text: string,
  targetSize: number,
  overlap: number,
): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length === 0) return [];
  if (clean.length <= targetSize) return [clean];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) chunks.push(trimmed);
    // Seed the next chunk with the tail of this one for overlap.
    current = overlap > 0 ? trimmed.slice(-overlap) : "";
  };

  for (const para of paragraphs) {
    if (para.length > targetSize) {
      // Paragraph too big on its own: flush, then hard-split by sentence.
      if (current.trim().length > 0) flush();
      for (const piece of hardSplit(para, targetSize, overlap)) chunks.push(piece);
      current = overlap > 0 ? (chunks[chunks.length - 1] ?? "").slice(-overlap) : "";
      continue;
    }
    if (current.length + para.length + 2 > targetSize && current.trim().length > 0) {
      flush();
    }
    current += (current.length > 0 ? "\n\n" : "") + para;
  }
  if (current.trim().length > 0) chunks.push(current.trim());

  // De-dup consecutive identical chunks that overlap-seeding can produce.
  return chunks.filter((c, i) => i === 0 || c !== chunks[i - 1]);
}

/** Split a single oversized block by sentence boundaries into <= size pieces. */
function hardSplit(block: string, size: number, overlap: number): string[] {
  const sentences = block.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur.length + s.length + 1 > size && cur.length > 0) {
      out.push(cur.trim());
      cur = overlap > 0 ? cur.slice(-overlap) : "";
    }
    cur += (cur.length > 0 ? " " : "") + s;
  }
  if (cur.trim().length > 0) out.push(cur.trim());
  return out;
}
