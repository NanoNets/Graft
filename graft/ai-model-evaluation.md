---
name: AI Model Evaluation
slug: ai-model-evaluation
type: system
sources:
  - path: bench/judge.ts
    hash: 94c222341b066e4f3134b3d9d3f30f31b9ffe7b92967086b07c58f297d349936
sources_digest: bfba2049dadf6f189e964206041bfbb54d9515eabe1bf3cc28ea06450fa65de7
links:
  - to: benchmarking-framework
    relation: part_of
    description: >-
      It is a critical part of the benchmarking framework that assesses the
      correctness of AI outputs.
generator:
  version: 1
covers:
  - symbol: Verdict
    kind: interface
    at: 'bench/judge.ts:L18-L24'
  - symbol: JudgeInput
    kind: interface
    at: 'bench/judge.ts:L26-L32'
  - symbol: extractJson
    kind: function
    at: 'bench/judge.ts:L35-L49'
  - symbol: judge
    kind: function
    at: 'bench/judge.ts:L51-L87'
---
<!-- context:generated:start -->
## Summary

This component encompasses the evaluation of AI-generated answers against reference answers, utilizing a two-layer scoring mechanism to ensure robust correctness assessments. It integrates with the OpenRouter service for model interactions.

## Related

- part of [[benchmarking-framework]] — It is a critical part of the benchmarking framework that assesses the correctness of AI outputs.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
