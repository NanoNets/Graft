---
name: Configuration Management
slug: configuration-management
type: concept
sources:
  - path: src/ai/providers.ts
    hash: c0d1294d6fa49f6d06ff9bb137b34ea897f94a67810a839cd5705a1fa5995483
sources_digest: a131fc0c197424e0b9a6a1da0c7e97f8aaa37eb06f6720480e7959923c918071
links:
  - to: ai-model-evaluation
    relation: configures
    description: It configures the settings for the AI evaluation process.
generator:
  version: 1
covers:
  - symbol: EngineConfig
    kind: interface
    at: 'src/ai/providers.ts:L9-L25'
  - symbol: ResolvedConfig
    kind: interface
    at: 'src/ai/providers.ts:L28-L35'
  - symbol: resolveConfig
    kind: function
    at: 'src/ai/providers.ts:L43-L55'
---
<!-- context:generated:start -->
## Summary

This concept encompasses the management of user-facing configurations for the AI engine, allowing customization of settings such as context directories and API credentials. It ensures that all necessary parameters are set for the engine to function correctly.

## Related

- configures [[ai-model-evaluation]] — It configures the settings for the AI evaluation process.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
