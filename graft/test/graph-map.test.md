# test/graph-map.test.ts

- fileNode · function · L16-L31 — function fileNode(path: string): NodeV1
- symNode · function · L33-L49 — function symNode(path: string, name: string, opts: { kind?: Kind; span?: string } = {}): NodeV1
- edge · function · L51-L53 — function edge(source: string, target: string, relation: Relation = "calls"): EdgeV1
- graphOf · function · L55-L61 — function graphOf(nodes: NodeV1[], edges: EdgeV1[]): GraphV1
- bigFixture · function · L240-L259 — function bigFixture(): GraphV1
