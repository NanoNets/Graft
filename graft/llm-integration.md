---
name: LLM Integration
slug: llm-integration
type: system
sources:
  - path: bench/llm.ts
    hash: 6fc86553ce48879cb28b411747fe3ffaa2ad5c269e5de50d83e4ed8b629cae2b
sources_digest: 4f4e246df7420566c35c5613d87662927000d8a548af5960275c64cc0a6e125e
links:
  - to: agent
    relation: produces
    description: The LLM integration provides models that the agent uses for processing.
  - to: judge
    relation: produces
    description: The LLM integration provides models that the judge uses for evaluation.
generator:
  version: 1
covers:
  - symbol: makeChatModel
    kind: function
    at: 'bench/llm.ts:L16-L28'
---
<!-- context:generated:start -->
## Summary

This component serves as the integration layer for various language models used in the benchmarking process, allowing for flexible configuration and interaction with different AI providers. It ensures that models are correctly instantiated and utilized across the system.

## Related

- produces [[agent]] — The LLM integration provides models that the agent uses for processing.
- produces [[judge]] — The LLM integration provides models that the judge uses for evaluation.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
