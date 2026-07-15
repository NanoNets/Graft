---
name: OpenRouter Integration
slug: openrouter-integration
type: system
sources:
  - path: bench/llm.ts
    hash: 6c0d2a02ac6aa86de94f779355020700a4d9016e2f4b431bf75560e1d3c51229
sources_digest: 1bdc59307386b5187ea92242900b2c3b286de3f9f45a08a7dfcf1c2d11801b27
links:
  - to: benchmarking-framework
    relation: part_of
    description: >-
      It is a foundational component that supports the benchmarking framework's
      operations.
generator:
  version: 1
covers:
  - symbol: makeClient
    kind: function
    at: 'bench/llm.ts:L14-L18'
---
<!-- context:generated:start -->
## Summary

This component serves as the integration layer for interacting with the OpenRouter service, allowing the benchmarking framework to utilize various AI models without requiring separate API keys. It manages client creation and configuration for model interactions.

## Related

- part of [[benchmarking-framework]] — It is a foundational component that supports the benchmarking framework's operations.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
