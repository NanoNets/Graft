import { readFile } from "node:fs/promises";

/**
 * Extract plain text from a PDF file.
 *
 * Uses `unpdf` (a pure-JS build of pdf.js) so there are no native binaries to
 * compile — it works anywhere Node runs, which keeps the `curl | sh` install
 * story honest. Pages are merged into a single string for chunking.
 */
export async function extractPdfText(path: string): Promise<string> {
  const buffer = await readFile(path);
  return extractPdfTextFromData(new Uint8Array(buffer));
}

/**
 * Extract plain text from PDF bytes already in memory — used for browser
 * uploads, where there is no file on the server's disk to read.
 */
export async function extractPdfTextFromData(data: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n\n") : text;
}

/** True if the path looks like a PDF (by extension). */
export function isPdfPath(path: string): boolean {
  return /\.pdf$/i.test(path);
}
