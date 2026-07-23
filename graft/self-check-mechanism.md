---
name: Self-Check Mechanism
slug: self-check-mechanism
type: system
sources:
  - path: bench/selfcheck.ts
    hash: 858ec7cce92c9105c4e111ae58f1d1a1b1b57372b96768804308009760c9b2f6
sources_digest: 9e4f820e588b39901b8509f53d03b4a0d5451ee79d098d970f3a88d7c6765c7c
links:
  - to: agent
    relation: uses
    description: The self-check mechanism simulates the agent's behavior.
generator:
  version: 1
covers:
  - symbol: makeStubModel
    kind: function
    at: 'bench/selfcheck.ts:L20-L39'
  - symbol: create
    kind: method
    at: 'bench/selfcheck.ts:L24-L37'
  - symbol: main
    kind: function
    at: 'bench/selfcheck.ts:L41-L105'
---
<!-- context:generated:start -->
## Summary

This component allows for offline verification of the agent's control flow and tool execution without requiring an API key, using a stubbed model to simulate responses and evaluate correctness.

## Related

- uses [[agent]] — The self-check mechanism simulates the agent's behavior.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
