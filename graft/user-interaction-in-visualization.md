---
name: User Interaction in Visualization
slug: user-interaction-in-visualization
type: concept
sources:
  - path: viewer/detail.ts
    hash: fe8df7c5561f2a8588cf4e1ecb367d19cb6b480fe4855f05e4f96137d8078884
  - path: viewer/graph.ts
    hash: 192a59b16da8327457de6723893fd9207dd9570a35cd664f96534a7b85e73e01
  - path: viewer/main.ts
    hash: ab45ce4dfe66aafbe779b71d49d6370b3fe64482307b994e857ce34d3f317325
sources_digest: 949fbcf087492dc70392ec9143ab9070d6c27e57720cbb7fa1b4324d473e7423
links:
  - to: graph-visualization
    relation: implements
    description: >-
      User interactions must be effectively managed to enhance the overall
      experience of exploring the graph.
generator:
  version: 1
covers:
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
---
<!-- context:generated:start -->
## Summary

This concept addresses the design decisions related to user interactions within the graph visualization, including navigation, selection, and dynamic updates based on user actions.

## Related

- implements [[graph-visualization]] — User interactions must be effectively managed to enhance the overall experience of exploring the graph.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
