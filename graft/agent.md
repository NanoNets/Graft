---
name: Agent
slug: agent
type: system
sources:
  - path: bench/agent.ts
    hash: 34a496d38f2dfc14688cb4f0981262d79dacef165bd1a4f9874b94c31e1819e9
sources_digest: 989950aca29644904bb9a7040d36a735534f3b0d1b3854912a2303e5b0831423
links:
  - to: llm-integration
    relation: uses
    description: The agent relies on language models for processing queries.
  - to: tasks
    relation: depends_on
    description: The agent executes tasks defined in the benchmark corpus.
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
---
<!-- context:generated:start -->
## Summary

The agent component implements a benchmark agent that processes questions using filesystem tools and a language model, tracking metrics such as token usage and tool calls. It emphasizes safety and correctness in its operations, ensuring secure filesystem access and accurate reporting of resource usage.

## Related

- uses [[llm-integration]] — The agent relies on language models for processing queries.
- depends on [[tasks]] — The agent executes tasks defined in the benchmark corpus.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
