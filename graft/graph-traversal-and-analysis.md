---
name: Graph Traversal and Analysis
slug: graph-traversal-and-analysis
type: system
sources:
  - path: src/graph/traverse-cli.ts
    hash: 080714fc91e5caefe4548e87c071b2010fdc593a670366db941d9fd2907b08e2
  - path: src/graph/traverse.ts
    hash: dd38bef08a175c1db6751823f7f6f1eaae3952227737b063373987f69c52d7fa
  - path: src/search/grep-cli.ts
    hash: 70bcb32d3ae5e4e9e39eb8b07151da7145a08756015e91f215edcadce5bddef8
  - path: src/search/grep.ts
    hash: e0ba3aaa565892e2772e4de0492931a568fc3f3724f8fca44b2a188a24e5eeb4
sources_digest: 0d510fdb8ad732a39d2c989024794702526f50a3a8555dce95314cb5b80d3a0a
links:
  - to: graph-extraction-and-loading
    relation: uses
    description: It utilizes the extracted graph data for traversal and analysis.
  - to: graph-representation
    relation: depends_on
    description: It depends on the graph representation defined in the previous component.
generator:
  version: 1
covers:
  - symbol: CallersCliOptions
    kind: interface
    at: 'src/graph/traverse-cli.ts:L21-L30'
  - symbol: headerOf
    kind: function
    at: 'src/graph/traverse-cli.ts:L38-L40'
  - symbol: hitLine
    kind: function
    at: 'src/graph/traverse-cli.ts:L44-L49'
  - symbol: callersSavings
    kind: function
    at: 'src/graph/traverse-cli.ts:L55-L65'
  - symbol: looseNoteFor
    kind: function
    at: 'src/graph/traverse-cli.ts:L68-L72'
  - symbol: SymbolJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L74-L80'
  - symbol: MatchJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L82-L86'
  - symbol: HitJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L88-L96'
  - symbol: symbolJson
    kind: function
    at: 'src/graph/traverse-cli.ts:L98-L100'
  - symbol: hitJson
    kind: function
    at: 'src/graph/traverse-cli.ts:L102-L111'
  - symbol: resolveDirection
    kind: function
    at: 'src/graph/traverse-cli.ts:L114-L119'
  - symbol: runCallersCommand
    kind: function
    at: 'src/graph/traverse-cli.ts:L127-L182'
  - symbol: Direction
    kind: type
    at: 'src/graph/traverse.ts:L21-L21'
  - symbol: SymbolMatch
    kind: interface
    at: 'src/graph/traverse.ts:L25-L27'
  - symbol: ResolveSymbolOptions
    kind: interface
    at: 'src/graph/traverse.ts:L29-L32'
  - symbol: resolveSymbol
    kind: function
    at: 'src/graph/traverse.ts:L53-L78'
  - symbol: symbolMatches
    kind: function
    at: 'src/graph/traverse.ts:L80-L89'
  - symbol: EdgeHit
    kind: interface
    at: 'src/graph/traverse.ts:L94-L99'
  - symbol: callersOf
    kind: function
    at: 'src/graph/traverse.ts:L102-L110'
  - symbol: calleesOf
    kind: function
    at: 'src/graph/traverse.ts:L113-L121'
  - symbol: impactOf
    kind: function
    at: 'src/graph/traverse.ts:L129-L131'
  - symbol: impactOfMany
    kind: function
    at: 'src/graph/traverse.ts:L149-L184'
  - symbol: symbolsInFile
    kind: function
    at: 'src/graph/traverse.ts:L188-L190'
  - symbol: impactOfFile
    kind: function
    at: 'src/graph/traverse.ts:L201-L203'
  - symbol: edgeWalk
    kind: function
    at: 'src/graph/traverse.ts:L218-L222'
  - symbol: GrepCliOptions
    kind: interface
    at: 'src/search/grep-cli.ts:L16-L23'
  - symbol: groupHeader
    kind: function
    at: 'src/search/grep-cli.ts:L25-L28'
  - symbol: formatGroup
    kind: function
    at: 'src/search/grep-cli.ts:L30-L34'
  - symbol: formatGrepHeader
    kind: function
    at: 'src/search/grep-cli.ts:L37-L40'
  - symbol: truncationNote
    kind: function
    at: 'src/search/grep-cli.ts:L43-L50'
  - symbol: formatGrepResult
    kind: function
    at: 'src/search/grep-cli.ts:L54-L62'
  - symbol: zeroHitNote
    kind: function
    at: 'src/search/grep-cli.ts:L72-L77'
  - symbol: runGrepCommand
    kind: function
    at: 'src/search/grep-cli.ts:L86-L115'
  - symbol: GrepHit
    kind: interface
    at: 'src/search/grep.ts:L18-L22'
  - symbol: GrepSymbolRef
    kind: interface
    at: 'src/search/grep.ts:L24-L32'
  - symbol: GrepGroup
    kind: interface
    at: 'src/search/grep.ts:L34-L43'
  - symbol: GrepResult
    kind: interface
    at: 'src/search/grep.ts:L45-L62'
  - symbol: GrepOptions
    kind: interface
    at: 'src/search/grep.ts:L64-L73'
  - symbol: escapeRegExp
    kind: function
    at: 'src/search/grep.ts:L79-L81'
  - symbol: spanBounds
    kind: function
    at: 'src/search/grep.ts:L83-L87'
  - symbol: SymbolSpan
    kind: interface
    at: 'src/search/grep.ts:L89-L93'
  - symbol: symbolsOf
    kind: function
    at: 'src/search/grep.ts:L97-L106'
  - symbol: enclosingSymbol
    kind: function
    at: 'src/search/grep.ts:L112-L119'
  - symbol: computeInDegree
    kind: function
    at: 'src/search/grep.ts:L123-L130'
  - symbol: toSymbolRef
    kind: function
    at: 'src/search/grep.ts:L132-L135'
  - symbol: grepGraph
    kind: function
    at: 'src/search/grep.ts:L137-L200'
---
<!-- context:generated:start -->
## Summary

This component provides core functionalities for traversing the graph structure, enabling symbol resolution, impact analysis, and dependency tracking within the codebase. It includes CLI tools for user interaction and ensures that graph traversal is efficient and testable.

## Related

- uses [[graph-extraction-and-loading]] — It utilizes the extracted graph data for traversal and analysis.
- depends on [[graph-representation]] — It depends on the graph representation defined in the previous component.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
