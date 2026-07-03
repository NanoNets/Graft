/** Cosine similarity of two equal-length vectors. Returns a value in [-1, 1]. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Rank `items` by cosine similarity of `getVec(item)` to `query`, returning the top `k`. */
export function topK<T>(
  query: number[],
  items: T[],
  getVec: (item: T) => number[] | undefined,
  k: number,
): Array<{ item: T; score: number }> {
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const vec = getVec(item);
    if (!vec) continue;
    scored.push({ item, score: cosineSimilarity(query, vec) });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}
