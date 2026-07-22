# test/graph-traverse.test.ts

- nodeStub · function · L15-L30 — function nodeStub(partial: Partial<NodeV1> & { id: string }): NodeV1
- edge · function · L32-L34 — function edge(source: string, target: string, relation: Relation = "calls"): EdgeV1
- graphOf · function · L36-L42 — function graphOf(nodes: NodeV1[], edges: EdgeV1[]): GraphV1
- baseGraph · function · L57-L66 — function baseGraph(): GraphV1
- diamondGraph · function · L167-L179 — function diamondGraph(): GraphV1
- fileAndSymbolGraph · function · L221-L231 — function fileAndSymbolGraph()
