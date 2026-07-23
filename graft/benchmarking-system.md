---
name: Benchmarking System
slug: benchmarking-system
type: system
sources:
  - path: bench/agent.ts
    hash: 34a496d38f2dfc14688cb4f0981262d79dacef165bd1a4f9874b94c31e1819e9
  - path: bench/judge.ts
    hash: bb48a8012b929bc0237f4d900d0ab7aa9a98f96777d72a89ce5305c6c57e6c47
  - path: bench/llm.ts
    hash: 6fc86553ce48879cb28b411747fe3ffaa2ad5c269e5de50d83e4ed8b629cae2b
  - path: bench/report.ts
    hash: 17c0be550f9712165177d070f58cbe7a0f60fcb2c1dc5830eb1a4dde97ec12f3
  - path: bench/run.ts
    hash: fd4445eb0d6d3c1a8b994c7e4be42522c3214612a8499e4f76bfc10d0030f9da
  - path: bench/selfcheck.ts
    hash: 858ec7cce92c9105c4e111ae58f1d1a1b1b57372b96768804308009760c9b2f6
  - path: bench/tasks.ts
    hash: efb90e69f52adcb08bfe45fb5a983fc676df68befdc455513e2581a24f46807e
  - path: bench/token-ab.ts
    hash: b033a023d063cccc329103fbd11d4e1a6ab16c5eb027e1dd85c47a63a7df4ff1
sources_digest: 918b737414aae73bb0f84df38880140028a61e8bf27b89b544943394d05bb10f
links:
  - to: agent
    relation: part_of
    description: The agent is responsible for executing tasks and collecting metrics.
  - to: judge
    relation: part_of
    description: The judge evaluates the correctness of the agent's responses.
  - to: llm-integration
    relation: part_of
    description: Integrates various language models for benchmarking.
  - to: report
    relation: part_of
    description: The report aggregates and presents benchmarking results.
  - to: tasks
    relation: part_of
    description: Tasks define the benchmark questions and expected answers.
generator:
  version: 1
covers:
  - symbol: AgentResult
    kind: interface
    at: 'bench/agent.ts:L20-L28'
  - symbol: RunAgentOptions
    kind: interface
    at: 'bench/agent.ts:L30-L42'
  - symbol: safePath
    kind: function
    at: 'bench/agent.ts:L51-L65'
  - symbol: listFiles
    kind: function
    at: 'bench/agent.ts:L67-L94'
  - symbol: walk
    kind: function
    at: 'bench/agent.ts:L69-L91'
  - symbol: globToRegExp
    kind: function
    at: 'bench/agent.ts:L97-L111'
  - symbol: runTool
    kind: function
    at: 'bench/agent.ts:L189-L259'
  - symbol: runAgent
    kind: function
    at: 'bench/agent.ts:L261-L341'
  - symbol: slideCacheBreakpoint
    kind: function
    at: 'bench/agent.ts:L289-L294'
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
  - symbol: makeChatModel
    kind: function
    at: 'bench/llm.ts:L16-L28'
  - symbol: Arm
    kind: type
    at: 'bench/report.ts:L6-L6'
  - symbol: Row
    kind: interface
    at: 'bench/report.ts:L8-L30'
  - symbol: costOf
    kind: function
    at: 'bench/report.ts:L37-L42'
  - symbol: mean
    kind: function
    at: 'bench/report.ts:L44-L46'
  - symbol: ArmAgg
    kind: interface
    at: 'bench/report.ts:L48-L58'
  - symbol: aggregate
    kind: function
    at: 'bench/report.ts:L60-L72'
  - symbol: pctDelta
    kind: function
    at: 'bench/report.ts:L74-L78'
  - symbol: fmt
    kind: function
    at: 'bench/report.ts:L80-L82'
  - symbol: metricTable
    kind: function
    at: 'bench/report.ts:L88-L114'
  - symbol: cells
    kind: function
    at: 'bench/report.ts:L93-L102'
  - symbol: verdictFor
    kind: function
    at: 'bench/report.ts:L117-L127'
  - symbol: buildMarkdown
    kind: function
    at: 'bench/report.ts:L129-L175'
  - symbol: Args
    kind: interface
    at: 'bench/run.ts:L39-L45'
  - symbol: parseArgs
    kind: function
    at: 'bench/run.ts:L47-L67'
  - symbol: pool
    kind: function
    at: 'bench/run.ts:L70-L81'
  - symbol: worker
    kind: function
    at: 'bench/run.ts:L73-L78'
  - symbol: main
    kind: function
    at: 'bench/run.ts:L83-L204'
  - symbol: makeStubModel
    kind: function
    at: 'bench/selfcheck.ts:L20-L39'
  - symbol: create
    kind: method
    at: 'bench/selfcheck.ts:L24-L37'
  - symbol: main
    kind: function
    at: 'bench/selfcheck.ts:L41-L105'
  - symbol: repoPath
    kind: function
    at: 'bench/tasks.ts:L30-L33'
  - symbol: Task
    kind: interface
    at: 'bench/tasks.ts:L35-L45'
  - symbol: Corpus
    kind: interface
    at: 'bench/tasks.ts:L47-L53'
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

This system orchestrates the benchmarking of AI agents and language models, facilitating comparisons of performance metrics such as token usage, latency, and correctness across different execution arms. It integrates various components including agents, judges, and reporting tools to provide a comprehensive evaluation framework.

## Related

- part of [[agent]] — The agent is responsible for executing tasks and collecting metrics.
- part of [[judge]] — The judge evaluates the correctness of the agent's responses.
- part of [[llm-integration]] — Integrates various language models for benchmarking.
- part of [[report]] — The report aggregates and presents benchmarking results.
- part of [[tasks]] — Tasks define the benchmark questions and expected answers.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
