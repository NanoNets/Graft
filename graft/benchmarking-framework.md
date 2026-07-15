---
name: Benchmarking Framework
slug: benchmarking-framework
type: system
sources:
  - path: bench/agent.ts
    hash: e10d64f913c9517cef84cce58ea042d71bed3e94182c791245170eca54060e31
  - path: bench/judge.ts
    hash: 94c222341b066e4f3134b3d9d3f30f31b9ffe7b92967086b07c58f297d349936
  - path: bench/report.ts
    hash: 775be8c40a8e4172521bba8f6a1f026fa23c4d24b9b5225da3ed5b745077a5b0
  - path: bench/run.ts
    hash: a0d2859628588f45ae31862f5f801d6219802449c23bbbdba9aa51b7b9febf47
  - path: bench/selfcheck.ts
    hash: 0eaf577938e20fa27d9cd0157bc8843fdc37165d85696789334b8605138f4bb4
  - path: bench/tasks.ts
    hash: d21168797f40d193a914aca0c438409d29d300441bc0a6a518c93869240b3b69
sources_digest: cc0c5db726f28fff7640e4c1d4705d7cd4eb54660db1b399622bd8f580ffe58d
links:
  - to: benchmarking-results-reporting
    relation: produces
    description: >-
      It generates detailed reports summarizing the performance metrics of the
      evaluated models.
  - to: openrouter-integration
    relation: depends_on
    description: >-
      The benchmarking framework relies on the OpenRouter service for model
      interactions.
generator:
  version: 1
covers:
  - symbol: AgentResult
    kind: interface
    at: 'bench/agent.ts:L19-L27'
  - symbol: RunAgentOptions
    kind: interface
    at: 'bench/agent.ts:L29-L37'
  - symbol: safePath
    kind: function
    at: 'bench/agent.ts:L46-L60'
  - symbol: listFiles
    kind: function
    at: 'bench/agent.ts:L62-L89'
  - symbol: walk
    kind: function
    at: 'bench/agent.ts:L64-L86'
  - symbol: globToRegExp
    kind: function
    at: 'bench/agent.ts:L92-L106'
  - symbol: runTool
    kind: function
    at: 'bench/agent.ts:L168-L228'
  - symbol: runAgent
    kind: function
    at: 'bench/agent.ts:L230-L322'
  - symbol: slideCacheBreakpoint
    kind: function
    at: 'bench/agent.ts:L254-L260'
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
  - symbol: Row
    kind: interface
    at: 'bench/report.ts:L6-L26'
  - symbol: costOf
    kind: function
    at: 'bench/report.ts:L33-L38'
  - symbol: mean
    kind: function
    at: 'bench/report.ts:L40-L42'
  - symbol: ArmAgg
    kind: interface
    at: 'bench/report.ts:L44-L54'
  - symbol: aggregate
    kind: function
    at: 'bench/report.ts:L56-L68'
  - symbol: pctDelta
    kind: function
    at: 'bench/report.ts:L70-L74'
  - symbol: fmt
    kind: function
    at: 'bench/report.ts:L76-L78'
  - symbol: buildMarkdown
    kind: function
    at: 'bench/report.ts:L80-L125'
  - symbol: Args
    kind: interface
    at: 'bench/run.ts:L29-L35'
  - symbol: parseArgs
    kind: function
    at: 'bench/run.ts:L37-L52'
  - symbol: pool
    kind: function
    at: 'bench/run.ts:L55-L66'
  - symbol: worker
    kind: function
    at: 'bench/run.ts:L58-L63'
  - symbol: makeDocsWorkdir
    kind: function
    at: 'bench/run.ts:L69-L82'
  - symbol: main
    kind: function
    at: 'bench/run.ts:L84-L201'
  - symbol: makeStubClient
    kind: function
    at: 'bench/selfcheck.ts:L19-L48'
  - symbol: main
    kind: function
    at: 'bench/selfcheck.ts:L50-L114'
  - symbol: repoPath
    kind: function
    at: 'bench/tasks.ts:L26-L29'
  - symbol: Task
    kind: interface
    at: 'bench/tasks.ts:L31-L37'
  - symbol: Corpus
    kind: interface
    at: 'bench/tasks.ts:L39-L45'
---
<!-- context:generated:start -->
## Summary

This component orchestrates the benchmarking process for evaluating AI models, including agents and judges, through various tasks and configurations. It integrates multiple files to manage agent execution, correctness scoring, and result reporting, ensuring a comprehensive evaluation of model performance.

## Related

- produces [[benchmarking-results-reporting]] — It generates detailed reports summarizing the performance metrics of the evaluated models.
- depends on [[openrouter-integration]] — The benchmarking framework relies on the OpenRouter service for model interactions.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
