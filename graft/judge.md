---
name: Judge
slug: judge
type: system
sources:
  - path: bench/judge.ts
    hash: bb48a8012b929bc0237f4d900d0ab7aa9a98f96777d72a89ce5305c6c57e6c47
sources_digest: b7c143d704da46109b37f03f603d29dcdd327ce19900ddfdf1b58ac4ead126ba
links:
  - to: llm-integration
    relation: uses
    description: The judge uses language models to evaluate answers.
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
    at: 'bench/judge.ts:L51-L86'
---
<!-- context:generated:start -->
## Summary

The judge component evaluates the correctness of the agent's responses against reference answers, utilizing a two-layer scoring system that includes keyword checks and model evaluations. It ensures robust and consistent assessment of AI-generated answers.

## Related

- uses [[llm-integration]] — The judge uses language models to evaluate answers.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
