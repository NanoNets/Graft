import { test } from "node:test";
import assert from "node:assert/strict";
import {
  poolFileEvidence,
  type FileEvidenceCandidate,
} from "../src/ask/file-evidence.js";

const evidence = (entries: Record<string, number>): ReadonlyMap<string, number> =>
  new Map(Object.entries(entries));

const candidate = (
  file: string,
  score: number,
  terms: Record<string, number>,
  eligible = true,
): FileEvidenceCandidate => ({ file, score, evidence: evidence(terms), eligible });

test("file evidence pooling is an identity for empty, singleton, and duplicate-term evidence", () => {
  assert.deepEqual(poolFileEvidence([]), []);
  assert.deepEqual(
    poolFileEvidence([candidate("auth.ts", 0.7, { auth: 1 })]),
    [0.7],
  );
  assert.deepEqual(
    poolFileEvidence([
      candidate("auth.ts", 0.8, { auth: 0.5 }),
      candidate("auth.ts", 0.6, { auth: 0.5 }),
    ]),
    [0.8, 0.6],
    "repeating one query term in sibling symbols must not create support",
  );
});

test("file evidence pooling rewards complementary terms while preserving the symbol-score ceiling", () => {
  const pooled = poolFileEvidence([
    candidate("auth.ts", 0.8, { authorize: 0.5 }),
    candidate("auth.ts", 0.7, { session: 0.5 }),
    candidate("noise.ts", 1, { authorize: 0.5 }),
  ]);

  assert.ok(Math.abs(pooled[0] - 1) < 1e-12, "distributed evidence becomes the top symbol");
  assert.ok(Math.abs(pooled[1] - 0.875) < 1e-12, "the sibling keeps its relative order");
  assert.ok(Math.abs(pooled[2] - 5 / 6) < 1e-12, "the unrelated symbol gets only the common rescale");
  assert.equal(Math.max(...pooled), 1, "pooling preserves the original score ceiling");
});

test("ineligible file nodes and graph-only hits neither contribute evidence nor receive a file factor", () => {
  const pooled = poolFileEvidence([
    candidate("auth.ts", 0.6, { authorize: 0.5 }),
    candidate("auth.ts", 0.9, { session: 0.5 }, false),
    candidate("auth.ts", 0.7, {}, false),
    candidate("noise.ts", 0.8, { authorize: 0.5 }),
  ]);

  assert.deepEqual(pooled, [0.6, 0.9, 0.7, 0.8]);
});

test("file evidence pooling groups by exact path and is permutation invariant", () => {
  const original = [
    candidate("frontend/auth.ts", 0.8, { authorize: 0.5 }),
    candidate("frontend/auth.ts", 0.7, { session: 0.5 }),
    candidate("backend/auth.ts", 1, { authorize: 0.5 }),
  ];
  const forward = poolFileEvidence(original);
  const permutation = [original[2], original[1], original[0]];
  const shuffled = poolFileEvidence(permutation);

  assert.ok(forward[0] > forward[2], "only the exact frontend path pools its sibling evidence");
  assert.deepEqual(
    [shuffled[2], shuffled[1], shuffled[0]],
    forward,
    "input order cannot affect a candidate's pooled score",
  );
});
