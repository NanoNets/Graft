# src/graph/load.ts

- CacheEntry · interface · L31-L35 — interface CacheEntry<T>
- __resetParseCounts · function · L45-L48 — function __resetParseCounts(): void
- statOf · function · L50-L57 — function statOf(path: string): { mtimeMs: number; size: number } | null
- loadCached · function · L59-L81 — function loadCached<T>( cache: Map<string, CacheEntry<T>>, path: string, parse: () => T | null, onParse: () => void, ): T | null
- loadGraphCached · function · L86-L91 — function loadGraphCached(outDir: string): GraphV1 | null
- loadAskIndexCached · function · L95-L100 — function loadAskIndexCached(outDir: string): AskIndex | null
