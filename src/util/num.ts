/**
 * Number formatting for text graft emits.
 *
 * `toLocaleString()` with no locale follows the MACHINE's locale, which is the
 * wrong authority for two of graft's outputs. The savings lines are read by an
 * LLM and explicitly ask it to sum them across calls; on a pt-BR/de-DE box the
 * bare call renders 1990 as "1.990", which an agent reads as 1.99 — so the
 * headline "tokens saved this turn" total comes out ~1000× low. The graph's own
 * stats are compared across machines and CI, where a separator that moves with
 * the host makes two identical runs look different.
 *
 * One pinned locale for both: the output is a data interchange format that
 * happens to be human-readable, not localized UI.
 */
const FORMATTER = new Intl.NumberFormat("en-US");

/** Thousands-separated integer, identical on every machine. */
export function formatCount(n: number): string {
  return FORMATTER.format(Math.round(n));
}
