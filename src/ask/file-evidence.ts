/**
 * One lexical candidate's evidence for its containing file.
 *
 * `evidence` stores the query-term shares matched by this symbol. The shares
 * use one shared IDF-weighted denominator, so their sum is the symbol's broad
 * coverage in [0, 1]. File nodes, graph-only rescues and test hits de-ranked
 * for a non-test query stay in the candidate list but set `eligible: false` —
 * they must not manufacture lexical support for their siblings. Test hits are
 * eligible when the query explicitly asks for tests.
 */
export interface FileEvidenceCandidate {
  file: string;
  score: number;
  evidence: ReadonlyMap<string, number>;
  eligible: boolean;
}

/** Sum finite positive evidence weights only. */
function evidenceShare(evidence: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const weight of evidence.values())
    if (Number.isFinite(weight) && weight > 0) total += weight;
  return total;
}

/**
 * Reward files whose symbols cover complementary parts of the query without
 * collapsing those symbols into a file-only result.
 *
 * For a file F, let U(F) be the IDF-weighted union of query terms matched by
 * its eligible symbols and B(F) the best individual symbol's coverage. The
 * complement `U(F) - B(F)` is evidence supplied only by sibling symbols:
 *
 *   pooled(symbol) = score(symbol) * (1 + U(F) - B(F))
 *
 * Repeating the same term across many symbols therefore adds nothing, while
 * two symbols that match disjoint halves of a query receive a 1.5x factor.
 * The factor is shared by the file's eligible symbols, preserving their local
 * order and exact spans. A final common rescale keeps the original symbol-score
 * ceiling, so pooling cannot silently change the symbol-vs-concept scale.
 *
 * The input is never mutated. Returned scores align with input order.
 */
export function poolFileEvidence(candidates: readonly FileEvidenceCandidate[]): number[] {
  const pooled = candidates.map((candidate) => candidate.score);
  const groups = new Map<
    string,
    { indexes: number[]; union: Map<string, number>; bestCoverage: number }
  >();

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const coverage = evidenceShare(candidate.evidence);
    if (
      !candidate.eligible ||
      !candidate.file ||
      !Number.isFinite(candidate.score) ||
      candidate.score <= 0 ||
      coverage <= 0
    ) continue;

    let group = groups.get(candidate.file);
    if (!group) {
      group = { indexes: [], union: new Map(), bestCoverage: 0 };
      groups.set(candidate.file, group);
    }
    group.indexes.push(index);
    group.bestCoverage = Math.max(group.bestCoverage, coverage);
    for (const [term, weight] of candidate.evidence) {
      if (!Number.isFinite(weight) || weight <= 0) continue;
      group.union.set(term, Math.max(group.union.get(term) ?? 0, weight));
    }
  }

  for (const group of groups.values()) {
    if (group.indexes.length < 2) continue;
    const unionCoverage = evidenceShare(group.union);
    const complementarity = Math.min(1, Math.max(0, unionCoverage - group.bestCoverage));
    if (complementarity <= 0) continue;
    const factor = 1 + complementarity;
    for (const index of group.indexes) pooled[index] *= factor;
  }

  let beforeMax = 0;
  let afterMax = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const before = candidates[index].score;
    const after = pooled[index];
    if (Number.isFinite(before) && before > beforeMax) beforeMax = before;
    if (Number.isFinite(after) && after > afterMax) afterMax = after;
  }
  if (beforeMax > 0 && afterMax > beforeMax) {
    const scale = beforeMax / afterMax;
    for (let index = 0; index < pooled.length; index += 1)
      if (Number.isFinite(pooled[index]) && pooled[index] > 0) pooled[index] *= scale;
  }

  return pooled;
}
