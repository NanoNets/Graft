# src/graph/traverse-cli.ts

- TraverseKind · type · L17-L17 — type TraverseKind = "callers" | "callees" | "impact";
- TraverseCliOptions · interface · L19-L26 — interface TraverseCliOptions
- edgesFor · function · L31-L35 — function edgesFor(kind: TraverseKind, graph: GraphV1, node: NodeV1, depth: number): EdgeHit[]
- headerOf · function · L41-L43 — function headerOf(n: NodeV1): string
- hitLine · function · L45-L50 — function hitLine(kind: TraverseKind, hit: EdgeHit): string
- looseNoteFor · function · L54-L58 — function looseNoteFor(kind: TraverseKind, name: string): string
- SymbolJson · interface · L60-L66 — interface SymbolJson
- MatchJson · interface · L68-L72 — interface MatchJson
- HitJson · interface · L74-L82 — interface HitJson
- symbolJson · function · L84-L86 — function symbolJson(n: NodeV1): SymbolJson
- hitJson · function · L88-L97 — function hitJson(hit: EdgeHit): HitJson
- runTraverseCommand · function · L105-L155 — function runTraverseCommand(kind: TraverseKind, query: string, dir: string, opts: TraverseCliOptions): void
