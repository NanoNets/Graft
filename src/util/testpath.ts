/**
 * Whether a path names a test file/directory, by convention: Go (`_test.go`),
 * JS/TS (`.test.` / `.spec.`), PowerShell/Pester (`.Tests.ps1`), Python
 * (`test_*.py` / `conftest.py`), and a `tests?/`, `__tests__/`, or `spec/` dir
 * anywhere in the path.
 *
 * DUAL CONTRACT — this single classifier feeds two very different consumers,
 * and an edit here must consider BOTH:
 *   - ask.ts (soft rank-penalty): de-ranks test files in lexical search results
 *     so a test doesn't out-score the real definition on a token tie. A false
 *     positive/negative here just nudges ranking — low stakes.
 *   - resolve.ts (hard graph-topology input): demotes test-path candidates
 *     when tie-breaking an ambiguous PS name match. A false positive here can
 *     make a real cross-file edge disappear; a false negative lets a Pester
 *     mock keep poisoning ambiguity. Higher stakes than ask's use — see
 *     resolve.ts's resolveName for the empty-set fallback that bounds the risk.
 */
export function isTestPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec)\/|(_test|\.test|\.spec)\.[a-z]+$|\.tests\.ps1$|(^|\/)(test_[^/]+|conftest)\.py$/i.test(path || "");
}
