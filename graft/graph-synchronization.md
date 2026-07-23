---
name: Graph Synchronization
slug: graph-synchronization
type: concept
sources:
  - path: src/context/check.ts
    hash: 2444e1f4dfd78208a9b54942364ee1811d064459857c6d6cee178426e278d481
  - path: src/graph/check.ts
    hash: 5358023fe498fb2878e3aa9b6756272c39926dda865c6495d8f33d13c5ceb376
sources_digest: 9a6d9714cc8b93725ff7e5702bd59dca1a96a6a3ebb7cec5c2f2e7e72eb9f093
links:
  - to: benchmarking-system
    relation: validates
    description: Synchronization checks are part of the overall benchmarking process.
generator:
  version: 1
covers:
  - symbol: CheckResult
    kind: interface
    at: 'src/context/check.ts:L22-L30'
  - symbol: CheckOptions
    kind: interface
    at: 'src/context/check.ts:L32-L35'
  - symbol: checkContext
    kind: function
    at: 'src/context/check.ts:L37-L107'
  - symbol: formatCheckReport
    kind: function
    at: 'src/context/check.ts:L110-L135'
  - symbol: short
    kind: function
    at: 'src/context/check.ts:L137-L139'
  - symbol: GraphCheckResult
    kind: interface
    at: 'src/graph/check.ts:L27-L37'
  - symbol: GraphCheckOptions
    kind: interface
    at: 'src/graph/check.ts:L39-L41'
  - symbol: checkGraph
    kind: function
    at: 'src/graph/check.ts:L43-L101'
  - symbol: formatGraphCheckReport
    kind: function
    at: 'src/graph/check.ts:L104-L135'
---
<!-- context:generated:start -->
## Summary

This concept addresses the verification of synchronization between the context graph and the source code, ensuring that the graph accurately reflects the current state of the codebase.

## Related

- validates [[benchmarking-system]] — Synchronization checks are part of the overall benchmarking process.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
