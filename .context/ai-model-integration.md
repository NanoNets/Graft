---
name: AI Model Integration
slug: ai-model-integration
type: system
sources:
  - path: src/ai/providers.ts
    hash: 8d4258cf8990f2fb6ac4664221fe96b5385edf8428f5f5b8a75958b8447c2cb0
  - path: src/ai/summarize.ts
    hash: c207e3e66f7386f7baff659cf00a3d87901e86d33ad1c0b04e4bb7943f5b5c21
  - path: src/ai/synthesize.ts
    hash: 2455b828410429e13cb029b6d9d4ee00532808bb63deec658445aeabb1323db0
sources_digest: 22e2c0a1bc0211ff99916ab816560b79484d4b9f608ea978eeecd3c5f4116637
links:
  - to: benchmarking-system
    relation: part_of
    description: Supports the benchmarking system by providing AI model capabilities.
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

This system manages the integration of AI models for summarization and synthesis tasks, allowing for both local and remote processing through configurable settings.

## Related

- part of [[benchmarking-system]] — Supports the benchmarking system by providing AI model capabilities.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
