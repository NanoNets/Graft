---
name: Code Summarization and Synthesis
slug: code-summarization-and-synthesis
type: system
sources:
  - path: src/ai/crux.ts
    hash: e81750029e4c8641cdaf2b4894f595297839e07a73076e4cdac1522515f923a8
  - path: src/ai/summarize.ts
    hash: 6e67f3866c75d88a8b1d265e510578f3e3014d9cfd8b2469e6e4afbd67977f93
  - path: src/ai/synthesize.ts
    hash: 982ab91da10ae51fdba64466cbb614db14a51f2e100bb12a72178961d8dd97d7
sources_digest: 1916d34902c4bd664703e6c5da273beb26c2be5f55e971b3cc3f590f65cde3c7
links:
  - to: context-graph-management
    relation: produces
    description: >-
      It generates structured nodes that represent the architecture of the
      codebase.
generator:
  version: 1
covers:
  - symbol: NodeRef
    kind: interface
    at: 'src/ai/crux.ts:L21-L27'
  - symbol: FileCruxInput
    kind: interface
    at: 'src/ai/crux.ts:L29-L33'
  - symbol: NodeCrux
    kind: interface
    at: 'src/ai/crux.ts:L35-L40'
  - symbol: CruxSummarizer
    kind: interface
    at: 'src/ai/crux.ts:L42-L44'
  - symbol: numberLines
    kind: function
    at: 'src/ai/crux.ts:L63-L70'
  - symbol: userContent
    kind: function
    at: 'src/ai/crux.ts:L72-L81'
  - symbol: parseResults
    kind: function
    at: 'src/ai/crux.ts:L84-L98'
  - symbol: num
    kind: function
    at: 'src/ai/crux.ts:L88-L88'
  - symbol: OpenRouterCruxSummarizer
    kind: class
    at: 'src/ai/crux.ts:L101-L127'
  - symbol: constructor
    kind: method
    at: 'src/ai/crux.ts:L105-L112'
  - symbol: describeFile
    kind: method
    at: 'src/ai/crux.ts:L114-L126'
  - symbol: Summarizer
    kind: interface
    at: 'src/ai/summarize.ts:L13-L15'
  - symbol: userContent
    kind: function
    at: 'src/ai/summarize.ts:L28-L34'
  - symbol: OpenRouterSummarizer
    kind: class
    at: 'src/ai/summarize.ts:L37-L61'
  - symbol: constructor
    kind: method
    at: 'src/ai/summarize.ts:L41-L48'
  - symbol: summarize
    kind: method
    at: 'src/ai/summarize.ts:L50-L60'
  - symbol: SynthLink
    kind: interface
    at: 'src/ai/synthesize.ts:L12-L16'
  - symbol: SynthNode
    kind: interface
    at: 'src/ai/synthesize.ts:L19-L27'
  - symbol: FileSummary
    kind: interface
    at: 'src/ai/synthesize.ts:L30-L33'
  - symbol: Synthesizer
    kind: interface
    at: 'src/ai/synthesize.ts:L35-L37'
  - symbol: userContent
    kind: function
    at: 'src/ai/synthesize.ts:L92-L97'
  - symbol: clean
    kind: function
    at: 'src/ai/synthesize.ts:L100-L122'
  - symbol: OpenRouterSynthesizer
    kind: class
    at: 'src/ai/synthesize.ts:L134-L163'
  - symbol: constructor
    kind: method
    at: 'src/ai/synthesize.ts:L138-L141'
  - symbol: synthesize
    kind: method
    at: 'src/ai/synthesize.ts:L143-L162'
---
<!-- context:generated:start -->
## Summary

This component focuses on summarizing code definitions and synthesizing a structured representation of the codebase architecture. It utilizes AI models to generate concise summaries and structured nodes for the context graph.

## Related

- produces [[context-graph-management]] — It generates structured nodes that represent the architecture of the codebase.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
