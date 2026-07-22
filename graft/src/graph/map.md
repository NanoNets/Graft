# src/graph/map.ts

- Hub · interface · L25-L31 — interface Hub
- DirEntry · interface · L33-L39 — interface DirEntry
- RepoMap · interface · L41-L49 — interface RepoMap
- BuildRepoMapOptions · interface · L51-L58 — interface BuildRepoMapOptions
- dirKey · function · L70-L73 — function dirKey(path: string, depth: number): string
- computeInDegree · function · L78-L85 — function computeInDegree(graph: GraphV1): Map<string, number>
- topHubs · function · L90-L96 — function topHubs(nodes: NodeV1[], inDegree: Map<string, number>, cap: number): Hub[]
- sortedLanguages · function · L98-L105 — function sortedLanguages(paths: string[]): string[]
- buildRepoMap · function · L112-L180 — function buildRepoMap(graph: GraphV1, opts: BuildRepoMapOptions = {}): RepoMap
- depthFor · function · L137-L137 — depthFor = (path: string): number
- basenameOf · function · L184-L187 — function basenameOf(path: string): string
- formatDirHub · function · L189-L191 — function formatDirHub(h: Hub): string
- formatDirLine · function · L193-L198 — function formatDirLine(d: DirEntry): string
- formatHotspot · function · L200-L202 — function formatHotspot(h: Hub): string
- formatRepoMap · function · L210-L223 — function formatRepoMap(map: RepoMap): string
