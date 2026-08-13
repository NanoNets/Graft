import { readFileSync } from "node:fs";

/** Read source text, decoding Windows tooling's common UTF-16LE output. UTF-16BE
 * is rare and unsupported by Node's built-in decoders, so callers silently skip it. */
export function readSourceFile(path: string): string | null {
  const bytes = readFileSync(path);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  // A UTF-8 BOM has to come off here, not be left for the grammar: U+FEFF is category
  // Cf, not whitespace, and only the TS/JS and Python grammars list it in `extras`.
  // Every breadth grammar whose extras are just `/\s/` (Go, Java, C, C#, Rust…) starts
  // the parse with an ERROR node at offset 0 and recovers unpredictably from there.
  // This is not exotic on Windows: Visual Studio writes .cs with a BOM by default and
  // PowerShell 5.1's `Out-File -Encoding utf8` writes one for any file at all. Stripping
  // it in the single reader also keeps `contentHash` over exactly the bytes we parse,
  // which is what build/check/fingerprint agreement rests on.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  return bytes.toString("utf8");
}
