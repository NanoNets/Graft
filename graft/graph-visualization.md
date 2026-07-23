---
name: Graph Visualization
slug: graph-visualization
type: system
sources:
  - path: viewer/data.ts
    hash: e9c5c89ad933e06004cbeddc1b1d7b60a6057726a463c66f9673ba20a3c61afd
  - path: viewer/detail.ts
    hash: fe8df7c5561f2a8588cf4e1ecb367d19cb6b480fe4855f05e4f96137d8078884
  - path: viewer/graph.ts
    hash: 192a59b16da8327457de6723893fd9207dd9570a35cd664f96534a7b85e73e01
  - path: viewer/main.ts
    hash: ab45ce4dfe66aafbe779b71d49d6370b3fe64482307b994e857ce34d3f317325
  - path: viewer/tree.ts
    hash: d66e0157f4c2a1525c16505306eb3aabce82565c3d0e56199ea5b7a860290b01
sources_digest: fd0623540e7f7eed9942e3db2bc219f9a08b3814ac219dfb2b9a74f8c1aea966
links:
  - to: graph-traversal-and-impact-analysis
    relation: uses
    description: >-
      The visualization relies on the traversal utilities to accurately
      represent node relationships.
generator:
  version: 1
covers:
  - symbol: VizNode
    kind: interface
    at: 'viewer/data.ts:L6-L12'
  - symbol: VizEdge
    kind: interface
    at: 'viewer/data.ts:L14-L20'
  - symbol: VizGraph
    kind: interface
    at: 'viewer/data.ts:L22-L26'
  - symbol: Family
    kind: type
    at: 'viewer/data.ts:L29-L29'
  - symbol: famOf
    kind: function
    at: 'viewer/data.ts:L39-L41'
  - symbol: chipKey
    kind: function
    at: 'viewer/data.ts:L47-L51'
  - symbol: colorToken
    kind: function
    at: 'viewer/data.ts:L72-L75'
  - symbol: cvar
    kind: function
    at: 'viewer/data.ts:L77-L79'
  - symbol: loadContextGraph
    kind: function
    at: 'viewer/data.ts:L81-L84'
  - symbol: CodeGraphV1
    kind: interface
    at: 'viewer/data.ts:L86-L93'
  - symbol: loadCodeGraph
    kind: function
    at: 'viewer/data.ts:L96-L113'
  - symbol: onServerChange
    kind: function
    at: 'viewer/data.ts:L116-L121'
  - symbol: esc
    kind: function
    at: 'viewer/detail.ts:L8-L10'
  - symbol: renderDetail
    kind: function
    at: 'viewer/detail.ts:L12-L58'
  - symbol: name
    kind: function
    at: 'viewer/detail.ts:L29-L29'
  - symbol: linkList
    kind: function
    at: 'viewer/detail.ts:L40-L50'
  - symbol: SimNode
    kind: interface
    at: 'viewer/graph.ts:L22-L30'
  - symbol: SimEdge
    kind: interface
    at: 'viewer/graph.ts:L32-L38'
  - symbol: el
    kind: function
    at: 'viewer/graph.ts:L42-L46'
  - symbol: GraphView
    kind: class
    at: 'viewer/graph.ts:L48-L334'
  - symbol: constructor
    kind: method
    at: 'viewer/graph.ts:L65-L69'
  - symbol: buildChrome
    kind: method
    at: 'viewer/graph.ts:L71-L78'
  - symbol: ensureMarkers
    kind: method
    at: 'viewer/graph.ts:L80-L91'
  - symbol: setData
    kind: method
    at: 'viewer/graph.ts:L94-L136'
  - symbol: buildElements
    kind: method
    at: 'viewer/graph.ts:L138-L164'
  - symbol: tick
    kind: method
    at: 'viewer/graph.ts:L166-L182'
  - symbol: restyle
    kind: method
    at: 'viewer/graph.ts:L185-L243'
  - symbol: nodeShown
    kind: function
    at: 'viewer/graph.ts:L195-L195'
  - symbol: select
    kind: method
    at: 'viewer/graph.ts:L245-L249'
  - symbol: focus
    kind: method
    at: 'viewer/graph.ts:L252-L261'
  - symbol: firstMatch
    kind: method
    at: 'viewer/graph.ts:L263-L266'
  - symbol: applyView
    kind: method
    at: 'viewer/graph.ts:L268-L270'
  - symbol: zoomBy
    kind: method
    at: 'viewer/graph.ts:L272-L279'
  - symbol: resetView
    kind: method
    at: 'viewer/graph.ts:L281-L284'
  - symbol: reheat
    kind: method
    at: 'viewer/graph.ts:L286-L288'
  - symbol: bindDrag
    kind: method
    at: 'viewer/graph.ts:L290-L309'
  - symbol: move
    kind: function
    at: 'viewer/graph.ts:L294-L299'
  - symbol: up
    kind: function
    at: 'viewer/graph.ts:L300-L305'
  - symbol: bindPanZoom
    kind: method
    at: 'viewer/graph.ts:L311-L333'
  - symbol: Tab
    kind: type
    at: 'viewer/main.ts:L10-L10'
  - symbol: $
    kind: function
    at: 'viewer/main.ts:L12-L12'
  - symbol: activeGraph
    kind: function
    at: 'viewer/main.ts:L23-L25'
  - symbol: graphTab
    kind: function
    at: 'viewer/main.ts:L27-L29'
  - symbol: renderChips
    kind: function
    at: 'viewer/main.ts:L32-L60'
  - symbol: rank
    kind: function
    at: 'viewer/main.ts:L43-L43'
  - symbol: glyphFor
    kind: function
    at: 'viewer/main.ts:L62-L71'
  - symbol: renderLegend
    kind: function
    at: 'viewer/main.ts:L74-L94'
  - symbol: updateShownCount
    kind: function
    at: 'viewer/main.ts:L96-L101'
  - symbol: updateCounts
    kind: function
    at: 'viewer/main.ts:L103-L112'
  - symbol: showDetail
    kind: function
    at: 'viewer/main.ts:L115-L124'
  - symbol: setTab
    kind: function
    at: 'viewer/main.ts:L129-L167'
  - symbol: showEmpty
    kind: function
    at: 'viewer/main.ts:L169-L173'
  - symbol: loadAll
    kind: function
    at: 'viewer/main.ts:L216-L223'
  - symbol: esc
    kind: function
    at: 'viewer/tree.ts:L7-L9'
  - symbol: renderOutline
    kind: function
    at: 'viewer/tree.ts:L11-L66'
  - symbol: kids
    kind: function
    at: 'viewer/tree.ts:L18-L22'
  - symbol: countDesc
    kind: function
    at: 'viewer/tree.ts:L23-L26'
  - symbol: row
    kind: function
    at: 'viewer/tree.ts:L29-L42'
---
<!-- context:generated:start -->
## Summary

This component is responsible for rendering and displaying the graph data, providing interactive visualizations that allow users to explore node relationships and details effectively.

## Related

- uses [[graph-traversal-and-impact-analysis]] — The visualization relies on the traversal utilities to accurately represent node relationships.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
