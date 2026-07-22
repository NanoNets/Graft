# src/search/grep.ts

- GrepHit · interface · L17-L21 — interface GrepHit
- GrepSymbolRef · interface · L23-L31 — interface GrepSymbolRef
- GrepGroup · interface · L33-L42 — interface GrepGroup
- GrepResult · interface · L44-L58 — interface GrepResult
- GrepOptions · interface · L60-L69 — interface GrepOptions
- escapeRegExp · function · L75-L77 — function escapeRegExp(s: string): string
- spanBounds · function · L79-L83 — function spanBounds(span: string): { start: number; end: number } | null
- SymbolSpan · interface · L85-L89 — interface SymbolSpan
- symbolsOf · function · L93-L102 — function symbolsOf(graph: GraphV1, path: string): SymbolSpan[]
- enclosingSymbol · function · L108-L115 — function enclosingSymbol(symbols: SymbolSpan[], line: number): NodeV1 | null
- computeInDegree · function · L119-L126 — function computeInDegree(graph: GraphV1): Map<string, number>
- toSymbolRef · function · L128-L131 — function toSymbolRef(n: NodeV1): GrepSymbolRef
- grepGraph · function · L133-L195 — function grepGraph(graph: GraphV1, repoRoot: string, pattern: string, opts: GrepOptions = {}): GrepResult
