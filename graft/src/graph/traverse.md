# src/graph/traverse.ts

- SymbolMatch · interface · L19-L21 — interface SymbolMatch
- ResolveSymbolOptions · interface · L23-L26 — interface ResolveSymbolOptions
- resolveSymbol · function · L47-L72 — function resolveSymbol(graph: GraphV1, query: string, opts: ResolveSymbolOptions = {}): NodeV1[]
- symbolMatches · function · L74-L83 — function symbolMatches(nodes: NodeV1[], lowerQuery: string): NodeV1[]
- EdgeHit · interface · L88-L93 — interface EdgeHit
- callersOf · function · L96-L104 — function callersOf(graph: GraphV1, symbol: NodeV1): EdgeHit[]
- calleesOf · function · L107-L115 — function calleesOf(graph: GraphV1, symbol: NodeV1): EdgeHit[]
- impactOf · function · L123-L125 — function impactOf(graph: GraphV1, symbol: NodeV1, maxDepth = 2): EdgeHit[]
- impactOfMany · function · L141-L172 — function impactOfMany(graph: GraphV1, seeds: NodeV1[], maxDepth = 2): EdgeHit[]
- symbolsInFile · function · L176-L178 — function symbolsInFile(graph: GraphV1, fileNode: NodeV1): NodeV1[]
- impactOfFile · function · L189-L191 — function impactOfFile(graph: GraphV1, fileNode: NodeV1, maxDepth = 2): EdgeHit[]
