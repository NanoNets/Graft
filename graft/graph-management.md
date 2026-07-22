---
name: Graph Management
slug: graph-management
type: system
sources:
  - path: src/graph/write.ts
    hash: 55dd6ea840135ade4db7f49042234bee0db07a9c8c959ab57767deb8bebc6345
sources_digest: fa6cd161fd547a03ecad2649fbb2b6094b5a6a64b10dcc1bdd6244e5157d4d48
links:
  - to: graph-construction
    relation: part_of
    description: Supports the construction of the context graph.
generator:
  version: 1
covers:
  - symbol: wiringPath
    kind: function
    at: 'src/graph/write.ts:L20-L22'
  - symbol: readGraph
    kind: function
    at: 'src/graph/write.ts:L28-L34'
  - symbol: writeGraph
    kind: function
    at: 'src/graph/write.ts:L36-L46'
  - symbol: stripBodyText
    kind: function
    at: 'src/graph/write.ts:L57-L61'
  - symbol: edgeOrder
    kind: function
    at: 'src/graph/write.ts:L63-L69'
---
<!-- context:generated:start -->
## Summary

This component manages the on-disk representation of the context graph, handling serialization, reading, and writing of graph data while ensuring data integrity and versioning.

## Related

- part of [[graph-construction]] — Supports the construction of the context graph.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
