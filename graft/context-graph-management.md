---
name: Context Graph Management
slug: context-graph-management
type: system
sources:
  - path: src/context/build.ts
    hash: 8c614e5dc6b1ef2d6949016ce7480099f95f021ea6b0882f2919397f97a68ce7
  - path: src/context/check.ts
    hash: 2444e1f4dfd78208a9b54942364ee1811d064459857c6d6cee178426e278d481
  - path: src/context/node-file.ts
    hash: 9e958d74597b4d6d31fa5391882ddab8faab4076d7d33f93de861ab6c2e0b93a
  - path: src/graph/build.ts
    hash: 8b05c94896ca63d9c66bf5b3340db53cb8600d536a36880a3012599edf1b3a44
  - path: src/graph/check.ts
    hash: f0b73053e31d03ec1280d465d614c97044541691675f2b3d09e10bcab5078b58
  - path: src/graph/enrich.ts
    hash: 7b8238702835246bfc446ae017157e627c7609fde83b090619de71d013edf8e6
  - path: src/graph/extract.ts
    hash: 58cd002d5ee7dfb750cb85293a795148ffbec31e68e2a9b693e0794543a7f727
  - path: src/graph/resolve.ts
    hash: dad41f73d773c45f5237b85e10a36ae45331cd5959df578816ee8ab47622cffe
  - path: src/graph/types.ts
    hash: 757b84c059d13cda49e0f29518b31a5473f0d6e243b2ab1f374a7f7ff02492e4
  - path: src/graph/write.ts
    hash: 55dd6ea840135ade4db7f49042234bee0db07a9c8c959ab57767deb8bebc6345
sources_digest: 55e6a39238b64c950511c3f7ca87ed1629d82b42231ba60ef5e8e90098ec441c
links:
  - to: code-summarization-and-synthesis
    relation: depends_on
    description: >-
      It relies on the summarization and synthesis components to generate
      structured nodes.
  - to: graph-visualization
    relation: produces
    description: It outputs a structured graph representation for visualization.
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
  - symbol: SourceRef
    kind: interface
    at: 'src/context/node-file.ts:L30-L33'
  - symbol: NodeLink
    kind: interface
    at: 'src/context/node-file.ts:L36-L40'
  - symbol: ContextNode
    kind: interface
    at: 'src/context/node-file.ts:L43-L58'
  - symbol: Manifest
    kind: interface
    at: 'src/context/node-file.ts:L61-L71'
  - symbol: slugify
    kind: function
    at: 'src/context/node-file.ts:L81-L86'
  - symbol: digestSources
    kind: function
    at: 'src/context/node-file.ts:L89-L95'
  - symbol: contextDirFor
    kind: function
    at: 'src/context/node-file.ts:L100-L103'
  - symbol: renderGenerated
    kind: function
    at: 'src/context/node-file.ts:L106-L118'
  - symbol: defaultHuman
    kind: function
    at: 'src/context/node-file.ts:L121-L123'
  - symbol: renderNodeFile
    kind: function
    at: 'src/context/node-file.ts:L126-L141'
  - symbol: preserveHuman
    kind: function
    at: 'src/context/node-file.ts:L148-L152'
  - symbol: writeNode
    kind: function
    at: 'src/context/node-file.ts:L158-L169'
  - symbol: ParsedNode
    kind: interface
    at: 'src/context/node-file.ts:L172-L179'
  - symbol: readNodes
    kind: function
    at: 'src/context/node-file.ts:L182-L198'
  - symbol: existingNodeSlugs
    kind: function
    at: 'src/context/node-file.ts:L201-L208'
  - symbol: deleteNode
    kind: function
    at: 'src/context/node-file.ts:L211-L214'
  - symbol: writeManifest
    kind: function
    at: 'src/context/node-file.ts:L216-L219'
  - symbol: readManifest
    kind: function
    at: 'src/context/node-file.ts:L221-L229'
  - symbol: GraphBuildOptions
    kind: interface
    at: 'src/graph/build.ts:L22-L33'
  - symbol: GraphBuildResult
    kind: interface
    at: 'src/graph/build.ts:L35-L48'
  - symbol: listSourceFiles
    kind: function
    at: 'src/graph/build.ts:L51-L53'
  - symbol: buildGraph
    kind: function
    at: 'src/graph/build.ts:L55-L143'
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
  - symbol: EnrichOptions
    kind: interface
    at: 'src/graph/enrich.ts:L28-L33'
  - symbol: EnrichStats
    kind: interface
    at: 'src/graph/enrich.ts:L35-L41'
  - symbol: enrichGraph
    kind: function
    at: 'src/graph/enrich.ts:L43-L128'
  - symbol: collectFileCrux
    kind: function
    at: 'src/graph/enrich.ts:L135-L155'
  - symbol: buildCrux
    kind: function
    at: 'src/graph/enrich.ts:L162-L177'
  - symbol: spanLines
    kind: function
    at: 'src/graph/enrich.ts:L180-L186'
  - symbol: Language
    kind: type
    at: 'src/graph/extract.ts:L16-L16'
  - symbol: languageOf
    kind: function
    at: 'src/graph/extract.ts:L19-L25'
  - symbol: RawEdge
    kind: interface
    at: 'src/graph/extract.ts:L31-L39'
  - symbol: ExtractResult
    kind: interface
    at: 'src/graph/extract.ts:L41-L44'
  - symbol: WalkCtx
    kind: interface
    at: 'src/graph/extract.ts:L76-L84'
  - symbol: DefDescriptor
    kind: interface
    at: 'src/graph/extract.ts:L87-L92'
  - symbol: extractFile
    kind: function
    at: 'src/graph/extract.ts:L94-L127'
  - symbol: walk
    kind: function
    at: 'src/graph/extract.ts:L129-L181'
  - symbol: describe
    kind: function
    at: 'src/graph/extract.ts:L184-L213'
  - symbol: heritageEdges
    kind: function
    at: 'src/graph/extract.ts:L215-L242'
  - symbol: calleeName
    kind: function
    at: 'src/graph/extract.ts:L244-L260'
  - symbol: isImport
    kind: function
    at: 'src/graph/extract.ts:L262-L264'
  - symbol: importSpecifier
    kind: function
    at: 'src/graph/extract.ts:L266-L277'
  - symbol: clean
    kind: function
    at: 'src/graph/extract.ts:L280-L287'
  - symbol: tsExported
    kind: function
    at: 'src/graph/extract.ts:L290-L297'
  - symbol: resolveEdges
    kind: function
    at: 'src/graph/resolve.ts:L20-L58'
  - symbol: add
    kind: function
    at: 'src/graph/resolve.ts:L34-L39'
  - symbol: push
    kind: function
    at: 'src/graph/resolve.ts:L60-L64'
  - symbol: resolveName
    kind: function
    at: 'src/graph/resolve.ts:L70-L82'
  - symbol: resolveImport
    kind: function
    at: 'src/graph/resolve.ts:L88-L100'
  - symbol: Kind
    kind: type
    at: 'src/graph/types.ts:L15-L22'
  - symbol: Confidence
    kind: type
    at: 'src/graph/types.ts:L25-L25'
  - symbol: SummaryState
    kind: type
    at: 'src/graph/types.ts:L28-L28'
  - symbol: Crux
    kind: interface
    at: 'src/graph/types.ts:L32-L35'
  - symbol: NodeV1
    kind: interface
    at: 'src/graph/types.ts:L37-L55'
  - symbol: Relation
    kind: type
    at: 'src/graph/types.ts:L57-L63'
  - symbol: EdgeV1
    kind: interface
    at: 'src/graph/types.ts:L65-L70'
  - symbol: GraphV1
    kind: interface
    at: 'src/graph/types.ts:L72-L81'
  - symbol: wiringPath
    kind: function
    at: 'src/graph/write.ts:L20-L22'
  - symbol: readGraph
    kind: function
    at: 'src/graph/write.ts:L28-L34'
  - symbol: writeGraph
    kind: function
    at: 'src/graph/write.ts:L36-L46'
  - symbol: edgeOrder
    kind: function
    at: 'src/graph/write.ts:L48-L54'
---
<!-- context:generated:start -->
## Summary

This component manages the construction and verification of a context graph from the code repository, ensuring synchronization with the source code. It includes functionalities for building, checking, and writing the graph data.

## Related

- depends on [[code-summarization-and-synthesis]] — It relies on the summarization and synthesis components to generate structured nodes.
- produces [[graph-visualization]] — It outputs a structured graph representation for visualization.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
