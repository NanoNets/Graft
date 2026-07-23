---
name: Configuration Management
slug: configuration-management
type: concept
sources:
  - path: src/ai/providers.ts
    hash: ba27e2c6d98b088685946371971e9f82c7a54bba9eaa432d44881880274eb1d6
  - path: src/claude/settings-merge.ts
    hash: eda59409ff8c470e7d3726a6740ba19e36e511ab40c67234aa794fabd9eacb8d
sources_digest: cbca57735b2ad73fb6d62dde432844f8879809265ad6f5274082ab955c08b5b8
links:
  - to: llm-integration
    relation: configures
    description: Configuration management affects how language models are instantiated.
generator:
  version: 1
covers:
  - symbol: EngineConfig
    kind: interface
    at: 'src/ai/providers.ts:L17-L39'
  - symbol: ResolvedConfig
    kind: interface
    at: 'src/ai/providers.ts:L42-L55'
  - symbol: resolveConfig
    kind: function
    at: 'src/ai/providers.ts:L71-L106'
  - symbol: Json
    kind: type
    at: 'src/claude/settings-merge.ts:L1-L1'
  - symbol: hookCmd
    kind: function
    at: 'src/claude/settings-merge.ts:L7-L9'
  - symbol: graftBlocks
    kind: function
    at: 'src/claude/settings-merge.ts:L10-L17'
  - symbol: isGraftHookEntry
    kind: function
    at: 'src/claude/settings-merge.ts:L18-L20'
  - symbol: mergeGraftSettings
    kind: function
    at: 'src/claude/settings-merge.ts:L22-L55'
---
<!-- context:generated:start -->
## Summary

This concept involves managing and merging configuration settings for various AI model providers, ensuring that user-defined settings are correctly applied and integrated into the system.

## Related

- configures [[llm-integration]] — Configuration management affects how language models are instantiated.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
