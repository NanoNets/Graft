/**
 * Conflict-free primitives that make the graph safe to merge across replicas.
 *
 * The whole point: two teammates can build the graph independently (offline, on
 * different machines) and later reconcile it — via a git pull of a serialized
 * graph, or an embedded-replica sync — **without** double-counting reinforcement
 * or letting merge order change the result.
 *
 * Two ideas do the heavy lifting:
 *
 *  1. **Observations are a grow-only counter (G-Counter).** Each observation
 *     event has a globally-unique key (the id of the document/contribution that
 *     produced it). Merging two counters is an element-wise `max`, which is
 *     commutative, associative and *idempotent* — replaying the same record is a
 *     no-op. `observations` (the scalar) and `confidence` are then *derived*
 *     from the counter, never mutated in place.
 *
 *  2. **Free-text fields (summary/description) are last-writer-wins registers**
 *     keyed by a wall-clock stamp, with deterministic tiebreaks so every replica
 *     picks the same winner.
 */
import type { ObservationCounter } from "./types.js";

/**
 * Confidence as a pure function of the observation total. Reproduces the
 * original reinforcement curve exactly — a fresh single observation is 0.6, and
 * each further observation closes 20% of the gap to 1 (0.6 → 0.68 → 0.744 → …),
 * capped at 0.99 — but as a *derivation* rather than a mutated register, so it
 * converges no matter how or how often records are merged.
 */
export function confidenceFromObservations(total: number): number {
  if (total <= 0) return 0.5;
  return Math.min(0.99, 1 - 0.4 * Math.pow(0.8, total - 1));
}

/** Sum of a G-Counter's per-source counts (the total observation count). */
export function totalObservations(sources: ObservationCounter): number {
  let n = 0;
  for (const key in sources) n += sources[key];
  return n;
}

/** Increment (in place) the count for one observation key. */
export function bumpObservation(sources: ObservationCounter, key: string, by = 1): void {
  sources[key] = (sources[key] ?? 0) + by;
}

/**
 * Merge two G-Counters by element-wise max. Commutative, associative, and
 * idempotent — the mathematical guarantee behind replay-safe imports.
 */
export function mergeObservationCounters(
  a: ObservationCounter,
  b: ObservationCounter,
): ObservationCounter {
  const out: ObservationCounter = { ...a };
  for (const key in b) out[key] = Math.max(out[key] ?? 0, b[key]);
  return out;
}

/** Set-union of two grow-only string sets (dropping empties), order-stable. */
export function unionSet(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b].filter((v) => v && v.length > 0))];
}

/**
 * Last-writer-wins pick between two timestamped text values. The newer stamp
 * wins; ties break toward the longer (more informative) text, then lexically —
 * so all replicas converge on the same choice regardless of merge order.
 */
export function pickLatestText(
  a: { text: string; at: string },
  b: { text: string; at: string },
): { text: string; at: string } {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  if (a.text.length !== b.text.length) return a.text.length > b.text.length ? a : b;
  return a.text >= b.text ? a : b;
}
