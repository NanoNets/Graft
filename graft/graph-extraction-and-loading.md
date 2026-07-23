---
name: Graph Extraction and Loading
slug: graph-extraction-and-loading
type: system
sources:
  - path: src/graph/extract.ts
    hash: 8449958d4b5fd74c8eafeb488ae16cb60dcaf3e5fcaf1e3069cebf4cf9ef48d9
  - path: src/graph/load.ts
    hash: 115b75e947618be7755ac59310f898943cb4c1d8266bdf5a4a30fdca4956914a
  - path: src/graph/relations.ts
    hash: e62bc9934057bf232f86edcf942e71b0a2f4c44b57ffd78ddb935b85ab75aca8
  - path: src/graph/resolve.ts
    hash: 23e2e29f6e907f079f0d214ac6ce24b6105c403a51da30c2f4d39494f4b6b110
  - path: src/graph/types.ts
    hash: 27a9bdbef7783e5da94c860bc83525ef788e38a2176bc1184c8adbee539b1b51
sources_digest: acfd590d81e375dfc632bbf862a013b910daf352d7ff1739e70ef80fd841fcfa
links:
  - to: graph-representation
    relation: part_of
    description: This system is part of the overall graph representation architecture.
  - to: graph-representation
    relation: produces
    description: It produces structured graph representations from source code.
generator:
  version: 1
covers:
  - symbol: Language
    kind: type
    at: 'src/graph/extract.ts:L18-L18'
  - symbol: languageOf
    kind: function
    at: 'src/graph/extract.ts:L21-L28'
  - symbol: RawEdge
    kind: interface
    at: 'src/graph/extract.ts:L34-L45'
  - symbol: ExtractResult
    kind: interface
    at: 'src/graph/extract.ts:L47-L50'
  - symbol: searchBody
    kind: function
    at: 'src/graph/extract.ts:L67-L70'
  - symbol: fileResidual
    kind: function
    at: 'src/graph/extract.ts:L78-L89'
  - symbol: WalkCtx
    kind: interface
    at: 'src/graph/extract.ts:L136-L147'
  - symbol: DefDescriptor
    kind: interface
    at: 'src/graph/extract.ts:L150-L156'
  - symbol: parseSource
    kind: function
    at: 'src/graph/extract.ts:L164-L166'
  - symbol: extractFile
    kind: function
    at: 'src/graph/extract.ts:L168-L209'
  - symbol: walk
    kind: function
    at: 'src/graph/extract.ts:L211-L278'
  - symbol: describe
    kind: function
    at: 'src/graph/extract.ts:L282-L313'
  - symbol: describeGo
    kind: function
    at: 'src/graph/extract.ts:L318-L356'
  - symbol: goReceiverType
    kind: function
    at: 'src/graph/extract.ts:L360-L366'
  - symbol: goExported
    kind: function
    at: 'src/graph/extract.ts:L370-L374'
  - symbol: heritageEdges
    kind: function
    at: 'src/graph/extract.ts:L376-L403'
  - symbol: calleeName
    kind: function
    at: 'src/graph/extract.ts:L405-L428'
  - symbol: pyReceiver
    kind: function
    at: 'src/graph/extract.ts:L432-L441'
  - symbol: tsReceiver
    kind: function
    at: 'src/graph/extract.ts:L444-L454'
  - symbol: isImport
    kind: function
    at: 'src/graph/extract.ts:L456-L461'
  - symbol: importSpecifier
    kind: function
    at: 'src/graph/extract.ts:L463-L479'
  - symbol: clean
    kind: function
    at: 'src/graph/extract.ts:L482-L489'
  - symbol: tsExported
    kind: function
    at: 'src/graph/extract.ts:L492-L499'
  - symbol: CacheEntry
    kind: interface
    at: 'src/graph/load.ts:L31-L35'
  - symbol: __resetParseCounts
    kind: function
    at: 'src/graph/load.ts:L45-L48'
  - symbol: statOf
    kind: function
    at: 'src/graph/load.ts:L50-L57'
  - symbol: loadCached
    kind: function
    at: 'src/graph/load.ts:L59-L81'
  - symbol: loadGraphCached
    kind: function
    at: 'src/graph/load.ts:L86-L91'
  - symbol: loadAskIndexCached
    kind: function
    at: 'src/graph/load.ts:L95-L100'
  - symbol: GoModule
    kind: interface
    at: 'src/graph/resolve.ts:L39-L42'
  - symbol: ResolveOptions
    kind: interface
    at: 'src/graph/resolve.ts:L44-L49'
  - symbol: resolveEdges
    kind: function
    at: 'src/graph/resolve.ts:L51-L140'
  - symbol: add
    kind: function
    at: 'src/graph/resolve.ts:L97-L102'
  - symbol: push
    kind: function
    at: 'src/graph/resolve.ts:L142-L146'
  - symbol: resolveName
    kind: function
    at: 'src/graph/resolve.ts:L152-L164'
  - symbol: resolveTypedMember
    kind: function
    at: 'src/graph/resolve.ts:L180-L213'
  - symbol: resolveImport
    kind: function
    at: 'src/graph/resolve.ts:L219-L231'
  - symbol: resolveGoImport
    kind: function
    at: 'src/graph/resolve.ts:L243-L258'
  - symbol: Kind
    kind: type
    at: 'src/graph/types.ts:L15-L23'
  - symbol: Confidence
    kind: type
    at: 'src/graph/types.ts:L26-L26'
  - symbol: SummaryState
    kind: type
    at: 'src/graph/types.ts:L29-L29'
  - symbol: Crux
    kind: interface
    at: 'src/graph/types.ts:L33-L36'
  - symbol: NodeV1
    kind: interface
    at: 'src/graph/types.ts:L38-L63'
  - symbol: Relation
    kind: type
    at: 'src/graph/types.ts:L65-L71'
  - symbol: EdgeV1
    kind: interface
    at: 'src/graph/types.ts:L73-L78'
  - symbol: ScopeV1
    kind: interface
    at: 'src/graph/types.ts:L84-L88'
  - symbol: GraphV1
    kind: interface
    at: 'src/graph/types.ts:L90-L102'
---
<!-- context:generated:start -->
## Summary

This component encompasses the extraction and loading of source code into a structured graph format, utilizing tree-sitter for parsing and caching mechanisms to optimize performance. It includes functionalities for tier-1 extraction, caching of graphs, and efficient loading of ask indices, ensuring that changes in source files are accurately reflected in the graph representation.

## Related

- part of [[graph-representation]] — This system is part of the overall graph representation architecture.
- produces [[graph-representation]] — It produces structured graph representations from source code.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
