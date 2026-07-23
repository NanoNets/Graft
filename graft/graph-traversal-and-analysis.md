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
  - symbol: TraverseKind
    kind: type
    at: 'src/graph/traverse-cli.ts:L17-L17'
  - symbol: TraverseCliOptions
    kind: interface
    at: 'src/graph/traverse-cli.ts:L19-L26'
  - symbol: edgesFor
    kind: function
    at: 'src/graph/traverse-cli.ts:L31-L35'
  - symbol: headerOf
    kind: function
    at: 'src/graph/traverse-cli.ts:L41-L43'
  - symbol: hitLine
    kind: function
    at: 'src/graph/traverse-cli.ts:L45-L50'
  - symbol: looseNoteFor
    kind: function
    at: 'src/graph/traverse-cli.ts:L54-L58'
  - symbol: SymbolJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L60-L66'
  - symbol: MatchJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L68-L72'
  - symbol: HitJson
    kind: interface
    at: 'src/graph/traverse-cli.ts:L74-L82'
  - symbol: symbolJson
    kind: function
    at: 'src/graph/traverse-cli.ts:L84-L86'
  - symbol: hitJson
    kind: function
    at: 'src/graph/traverse-cli.ts:L88-L97'
  - symbol: runTraverseCommand
    kind: function
    at: 'src/graph/traverse-cli.ts:L105-L155'
  - symbol: SymbolMatch
    kind: interface
    at: 'src/graph/traverse.ts:L19-L21'
  - symbol: ResolveSymbolOptions
    kind: interface
    at: 'src/graph/traverse.ts:L23-L26'
  - symbol: resolveSymbol
    kind: function
    at: 'src/graph/traverse.ts:L47-L72'
  - symbol: symbolMatches
    kind: function
    at: 'src/graph/traverse.ts:L74-L83'
  - symbol: EdgeHit
    kind: interface
    at: 'src/graph/traverse.ts:L88-L93'
  - symbol: callersOf
    kind: function
    at: 'src/graph/traverse.ts:L96-L104'
  - symbol: calleesOf
    kind: function
    at: 'src/graph/traverse.ts:L107-L115'
  - symbol: impactOf
    kind: function
    at: 'src/graph/traverse.ts:L123-L125'
  - symbol: impactOfMany
    kind: function
    at: 'src/graph/traverse.ts:L141-L172'
  - symbol: symbolsInFile
    kind: function
    at: 'src/graph/traverse.ts:L176-L178'
  - symbol: impactOfFile
    kind: function
    at: 'src/graph/traverse.ts:L189-L191'
  - symbol: GrepCliOptions
    kind: interface
    at: 'src/search/grep-cli.ts:L15-L22'
  - symbol: groupHeader
    kind: function
    at: 'src/search/grep-cli.ts:L24-L27'
  - symbol: formatGroup
    kind: function
    at: 'src/search/grep-cli.ts:L29-L33'
  - symbol: formatGrepHeader
    kind: function
    at: 'src/search/grep-cli.ts:L36-L39'
  - symbol: truncationNote
    kind: function
    at: 'src/search/grep-cli.ts:L42-L49'
  - symbol: formatGrepResult
    kind: function
    at: 'src/search/grep-cli.ts:L53-L59'
  - symbol: zeroHitNote
    kind: function
    at: 'src/search/grep-cli.ts:L69-L74'
  - symbol: runGrepCommand
    kind: function
    at: 'src/search/grep-cli.ts:L83-L112'
  - symbol: GrepHit
    kind: interface
    at: 'src/search/grep.ts:L17-L21'
  - symbol: GrepSymbolRef
    kind: interface
    at: 'src/search/grep.ts:L23-L31'
  - symbol: GrepGroup
    kind: interface
    at: 'src/search/grep.ts:L33-L42'
  - symbol: GrepResult
    kind: interface
    at: 'src/search/grep.ts:L44-L58'
  - symbol: GrepOptions
    kind: interface
    at: 'src/search/grep.ts:L60-L69'
  - symbol: escapeRegExp
    kind: function
    at: 'src/search/grep.ts:L75-L77'
  - symbol: spanBounds
    kind: function
    at: 'src/search/grep.ts:L79-L83'
  - symbol: SymbolSpan
    kind: interface
    at: 'src/search/grep.ts:L85-L89'
  - symbol: symbolsOf
    kind: function
    at: 'src/search/grep.ts:L93-L102'
  - symbol: enclosingSymbol
    kind: function
    at: 'src/search/grep.ts:L108-L115'
  - symbol: computeInDegree
    kind: function
    at: 'src/search/grep.ts:L119-L126'
  - symbol: toSymbolRef
    kind: function
    at: 'src/search/grep.ts:L128-L131'
  - symbol: grepGraph
    kind: function
    at: 'src/search/grep.ts:L133-L195'
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
