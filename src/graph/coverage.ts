/**
 * What the Tier-1 symbol graph does NOT cover, and how to say so (issue #66).
 *
 * The concept pass (`--deep`) and the symbol pass disagree about which
 * languages they support: {@link CODE_EXTENSIONS} is what the concept pass
 * reads as code, while `extract.ts` parses only the extensions it has a
 * grammar for. On a repo in the gap (Rust, Java, …), the symbol tools used to
 * return confident false negatives — "no hits", "no symbol", "no definitions"
 * — and even steered callers away from raw grep, the one tool that would have
 * worked. This module computes the gap at build time and phrases it honestly
 * at query time.
 */
import { CODE_EXTENSIONS } from "../context/build.js";
import { languageOf } from "./extract.js";

/** One unparseable code extension and how many files carry it. */
export interface UnindexedStat {
  ext: string;
  files: number;
}

const CODE_EXT_SET = new Set(CODE_EXTENSIONS);

function codeExtOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = path.slice(dot).toLowerCase();
  return CODE_EXT_SET.has(ext) ? ext : null;
}

/**
 * Count the code-like files (by {@link CODE_EXTENSIONS}) that no Tier-1
 * grammar parses, grouped by extension, most files first. Docs, configs and
 * other non-code files are not "skipped" — they were never expected to be in
 * the symbol graph.
 */
export function unindexedCodeStats(files: string[]): UnindexedStat[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (languageOf(f) !== null) continue;
    const ext = codeExtOf(f);
    if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1);
  }
  return [...counts]
    .map(([ext, n]) => ({ ext, files: n }))
    .sort((a, b) => b.files - a.files || a.ext.localeCompare(b.ext));
}

/** The `graft build` banner line for skipped code, or null when nothing was.
 * "skipped: 350 files (no parser: .h, .cpp) — symbol tools will not cover them" */
export function skippedLine(stats: UnindexedStat[]): string | null {
  if (stats.length === 0) return null;
  const total = stats.reduce((n, s) => n + s.files, 0);
  const exts = stats.map((s) => s.ext).join(", ");
  return `skipped: ${total} file${total === 1 ? "" : "s"} (no parser: ${exts}) — symbol tools will not cover them`;
}

/**
 * The sentence a zero-result answer appends so a coverage gap never reads as a
 * fact about the code. Null when there is no gap (the current messages are
 * already honest then).
 */
export function unindexedNote(stats: UnindexedStat[] | undefined): string | null {
  if (!stats || stats.length === 0) return null;
  const total = stats.reduce((n, s) => n + s.files, 0);
  const exts = stats.map((s) => s.ext).join(", ");
  const subject = `${total} source file${total === 1 ? "" : "s"} (${exts})`;
  const clause = total === 1 ? "has no parser and is" : "have no parser and are";
  return `${subject} ${clause} NOT in the symbol graph — if the target lives there, raw grep -rn / reading the file is the right tool`;
}

/** Sum per-extension counts across several graphs' `meta.unindexed` — the
 * workspace-federated view of the same gap, most files first. */
export function mergeUnindexed(lists: (UnindexedStat[] | undefined)[]): UnindexedStat[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const s of list ?? []) counts.set(s.ext, (counts.get(s.ext) ?? 0) + s.files);
  }
  return [...counts]
    .map(([ext, files]) => ({ ext, files }))
    .sort((a, b) => b.files - a.files || a.ext.localeCompare(b.ext));
}

/**
 * For a single file the caller named (e.g. `graft skeleton enemy_ai.rs`): when
 * its extension is code-like but unparseable, the honest answer is "no parser",
 * not "no definitions". Null for supported or non-code files.
 */
export function unsupportedFileNote(path: string): string | null {
  if (languageOf(path) !== null) return null;
  const ext = codeExtOf(path);
  if (!ext) return null;
  return `this file's language has no parser (${ext}) — the symbol graph does not cover it; read the file or use raw grep -rn`;
}
