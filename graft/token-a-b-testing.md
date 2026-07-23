---
name: Token A/B Testing
slug: token-a-b-testing
type: system
sources:
  - path: bench/token-ab.ts
    hash: b033a023d063cccc329103fbd11d4e1a6ab16c5eb027e1dd85c47a63a7df4ff1
sources_digest: 12c7bde30c776e231fe85e67e20d88c3b691c854a45b9bc463502f489874cdf7
links:
  - to: agent
    relation: uses
    description: The A/B testing harness evaluates the agent's performance.
generator:
  version: 1
covers:
  - symbol: Metrics
    kind: interface
    at: 'bench/token-ab.ts:L55-L64'
  - symbol: runSearch
    kind: function
    at: 'bench/token-ab.ts:L98-L128'
  - symbol: runRead
    kind: function
    at: 'bench/token-ab.ts:L130-L147'
  - symbol: runAgent
    kind: function
    at: 'bench/token-ab.ts:L150-L207'
  - symbol: graftPack
    kind: function
    at: 'bench/token-ab.ts:L210-L221'
  - symbol: cost
    kind: function
    at: 'bench/token-ab.ts:L223-L227'
  - symbol: row
    kind: function
    at: 'bench/token-ab.ts:L229-L231'
  - symbol: main
    kind: function
    at: 'bench/token-ab.ts:L233-L273'
  - symbol: pct
    kind: function
    at: 'bench/token-ab.ts:L253-L253'
---
<!-- context:generated:start -->
## Summary

This component implements a manual A/B testing harness to compare token usage between two evaluation arms of the agent, providing insights into the efficiency of different approaches in answering coding-related questions.

## Related

- uses [[agent]] — The A/B testing harness evaluates the agent's performance.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
