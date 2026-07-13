---
name: Benchmarking System
slug: benchmarking-system
type: system
sources:
  - path: bench/agent.ts
    hash: e10d64f913c9517cef84cce58ea042d71bed3e94182c791245170eca54060e31
  - path: bench/judge.ts
    hash: 94c222341b066e4f3134b3d9d3f30f31b9ffe7b92967086b07c58f297d349936
  - path: bench/llm.ts
    hash: 6c0d2a02ac6aa86de94f779355020700a4d9016e2f4b431bf75560e1d3c51229
  - path: bench/report.ts
    hash: 775be8c40a8e4172521bba8f6a1f026fa23c4d24b9b5225da3ed5b745077a5b0
  - path: bench/run.ts
    hash: f9d9235f3661e03b721564a786cc80cbd50584cedb6a80f0bbb5f7757ccd724b
  - path: bench/selfcheck.ts
    hash: 0eaf577938e20fa27d9cd0157bc8843fdc37165d85696789334b8605138f4bb4
  - path: bench/tasks.ts
    hash: d21168797f40d193a914aca0c438409d29d300441bc0a6a518c93869240b3b69
sources_digest: b82fc41740c1a096a0fd5c3f20776231e57194958bef6c87a28a6975ff3d9142
links:
  - to: ai-model-integration
    relation: uses
    description: Utilizes AI models for benchmarking tasks.
  - to: benchmarking-results-reporting
    relation: produces
    description: Generates reports summarizing benchmarking results.
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

This system orchestrates the benchmarking of AI models, facilitating the evaluation of performance metrics such as token usage, latency, and correctness through various components including agents, judges, and reporting mechanisms.

## Related

- uses [[ai-model-integration]] — Utilizes AI models for benchmarking tasks.
- produces [[benchmarking-results-reporting]] — Generates reports summarizing benchmarking results.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
