---
name: Graph Data Integrity
slug: graph-data-integrity
type: concept
sources:
  - path: test/graph-write.test.ts
    hash: cbbf9c3591519993ec89298444d34732f08eb16f90ba1c1cd33bd39d5512f9ff
sources_digest: 34c4a4eb40884a5f3072352f37d7efb647f89cb7fe8b9ba43d91eacbbad0c0c0
links:
  - to: graph-serialization
    relation: implements
    description: >-
      The serialization process must ensure that in-memory node objects remain
      unchanged.
generator:
  version: 1
covers:
  - symbol: makeNode
    kind: function
    at: 'test/graph-write.test.ts:L19-L35'
---
<!-- context:generated:start -->
## Summary

This principle focuses on maintaining the integrity of graph data during serialization and deserialization processes, ensuring that no unintended mutations occur.

## Related

- implements [[graph-serialization]] — The serialization process must ensure that in-memory node objects remain unchanged.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
