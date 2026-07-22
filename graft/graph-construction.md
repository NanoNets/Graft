---
name: Graph Construction
slug: graph-construction
type: system
sources:
  - path: src/context/build.ts
    hash: 8c614e5dc6b1ef2d6949016ce7480099f95f021ea6b0882f2919397f97a68ce7
  - path: src/context/check.ts
    hash: 2444e1f4dfd78208a9b54942364ee1811d064459857c6d6cee178426e278d481
  - path: src/graph/build.ts
    hash: b18f5fc18dffd77771f39722eb19963c1188fd298cbb5cfd5d71ef8dc45658c6
  - path: src/graph/check.ts
    hash: 5358023fe498fb2878e3aa9b6756272c39926dda865c6495d8f33d13c5ceb376
sources_digest: 542278c320dfc3ba4690fe870e4222ebb3eb9fa87d9c1cd94780003d54e72141
links:
  - to: code-summarization-and-synthesis
    relation: depends_on
    description: Relies on summarization and synthesis for node creation.
  - to: graph-management
    relation: part_of
    description: Forms a core part of the graph management system.
generator:
  version: 1
covers:
  - symbol: BuildProgress
    kind: interface
    at: 'src/context/build.ts:L47-L52'
  - symbol: BuildOptions
    kind: interface
    at: 'src/context/build.ts:L54-L64'
  - symbol: BuildResult
    kind: interface
    at: 'src/context/build.ts:L66-L75'
  - symbol: BuildCache
    kind: interface
    at: 'src/context/build.ts:L78-L81'
  - symbol: FileWork
    kind: interface
    at: 'src/context/build.ts:L83-L87'
  - symbol: NodeDraft
    kind: interface
    at: 'src/context/build.ts:L90-L97'
  - symbol: buildContext
    kind: function
    at: 'src/context/build.ts:L99-L266'
  - symbol: batchBySize
    kind: function
    at: 'src/context/build.ts:L269-L285'
  - symbol: batchKey
    kind: function
    at: 'src/context/build.ts:L288-L295'
  - symbol: registerName
    kind: function
    at: 'src/context/build.ts:L297-L300'
  - symbol: resolveSlug
    kind: function
    at: 'src/context/build.ts:L302-L304'
  - symbol: errMsg
    kind: function
    at: 'src/context/build.ts:L306-L308'
  - symbol: cachePath
    kind: function
    at: 'src/context/build.ts:L310-L312'
  - symbol: loadCache
    kind: function
    at: 'src/context/build.ts:L314-L325'
  - symbol: saveCache
    kind: function
    at: 'src/context/build.ts:L327-L331'
  - symbol: mapWithConcurrency
    kind: function
    at: 'src/context/build.ts:L334-L349'
  - symbol: CheckResult
    kind: interface
    at: 'src/context/check.ts:L22-L30'
  - symbol: CheckOptions
    kind: interface
    at: 'src/context/check.ts:L32-L35'
  - symbol: checkContext
    kind: function
    at: 'src/context/check.ts:L37-L107'
  - symbol: formatCheckReport
    kind: function
    at: 'src/context/check.ts:L110-L135'
  - symbol: short
    kind: function
    at: 'src/context/check.ts:L137-L139'
  - symbol: GraphBuildOptions
    kind: interface
    at: 'src/graph/build.ts:L23-L36'
  - symbol: GraphBuildResult
    kind: interface
    at: 'src/graph/build.ts:L38-L51'
  - symbol: listSourceFiles
    kind: function
    at: 'src/graph/build.ts:L54-L56'
  - symbol: readGoModules
    kind: function
    at: 'src/graph/build.ts:L62-L76'
  - symbol: buildGraph
    kind: function
    at: 'src/graph/build.ts:L78-L183'
  - symbol: GraphCheckResult
    kind: interface
    at: 'src/graph/check.ts:L27-L37'
  - symbol: GraphCheckOptions
    kind: interface
    at: 'src/graph/check.ts:L39-L41'
  - symbol: checkGraph
    kind: function
    at: 'src/graph/check.ts:L43-L101'
  - symbol: formatGraphCheckReport
    kind: function
    at: 'src/graph/check.ts:L104-L135'
---
<!-- context:generated:start -->
## Summary

This component constructs a context graph from the code repository, managing the relationships between code elements and ensuring synchronization with the source code.

## Related

- depends on [[code-summarization-and-synthesis]] — Relies on summarization and synthesis for node creation.
- part of [[graph-management]] — Forms a core part of the graph management system.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
