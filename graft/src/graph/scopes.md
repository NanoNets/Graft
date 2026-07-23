# src/graph/scopes.ts

- collectDirs · function · L37-L56 — function collectDirs(root: string): string[]
- walk · function · L39-L53 — walk = (absDir: string, relDir: string): void
- parsePnpmPackagesList · function · L60-L73 — function parsePnpmPackagesList(text: string): string[] | null
- readWorkspaceGlobs · function · L78-L100 — function readWorkspaceGlobs(root: string): string[] | null
- resolveGlob · function · L105-L166 — function resolveGlob(root: string, pattern: string): string[]
- listDirs · function · L140-L150 — listDirs = (absDir: string, relDir: string): string[]
- Candidate · interface · L168-L171 — interface Candidate
- discoverScopes · function · L174-L307 — function discoverScopes(root: string): ScopeV1[]
- findNearestAncestorCandidate · function · L254-L264 — findNearestAncestorCandidate = ( prefix: string, set: ReadonlyMap<string, Candidate>, ): string | null
- scopeOf · function · L312-L318 — function scopeOf(path: string, scopes: ScopeV1[]): ScopeV1
- scopeLabel · function · L323-L325 — function scopeLabel(prefix: string): string
- scopesHereClause · function · L331-L334 — function scopesHereClause(scopes: ScopeV1[]): string
- pathUnderPrefix · function · L341-L343 — function pathUnderPrefix(path: string, prefix: string): boolean
- discoverWorkspaceChildren · function · L347-L364 — function discoverWorkspaceChildren(root: string): string[]
- scopesOfGraph · function · L369-L371 — function scopesOfGraph(graph: GraphV1): ScopeV1[]
