---
name: Visualization and Serving
slug: visualization-and-serving
type: system
sources:
  - path: src/viz/assemble.ts
    hash: 58ad5caed087bd7b929f5b625501a607e79e0476f998636bec241e0296706ece
  - path: src/viz/serve.ts
    hash: 14283762f454c01fc95cfbe9c2b41ef063fc17c4c3e5d120b5dc7f66f541fc1c
sources_digest: 88ca5c49a63bfa8625974ff180102457ba16dd9538fa82d23bbe252becd035d8
links:
  - to: graph-representation
    relation: produces
    description: It produces visual representations of the graph structure.
  - to: graph-traversal-and-analysis
    relation: uses
    description: It utilizes the graph traversal capabilities for visualization.
generator:
  version: 1
covers:
  - symbol: VizNode
    kind: interface
    at: 'src/viz/assemble.ts:L18-L24'
  - symbol: VizEdge
    kind: interface
    at: 'src/viz/assemble.ts:L26-L31'
  - symbol: VizGraph
    kind: interface
    at: 'src/viz/assemble.ts:L33-L42'
  - symbol: normalizeRelation
    kind: function
    at: 'src/viz/assemble.ts:L56-L58'
  - symbol: extractSummary
    kind: function
    at: 'src/viz/assemble.ts:L65-L76'
  - symbol: assembleContextGraph
    kind: function
    at: 'src/viz/assemble.ts:L79-L130'
  - symbol: VizServerOptions
    kind: interface
    at: 'src/viz/serve.ts:L16-L21'
  - symbol: VizServer
    kind: interface
    at: 'src/viz/serve.ts:L23-L26'
  - symbol: sendJson
    kind: function
    at: 'src/viz/serve.ts:L38-L41'
  - symbol: listen
    kind: function
    at: 'src/viz/serve.ts:L43-L55'
  - symbol: onError
    kind: function
    at: 'src/viz/serve.ts:L45-L48'
  - symbol: startVizServer
    kind: function
    at: 'src/viz/serve.ts:L57-L148'
  - symbol: close
    kind: method
    at: 'src/viz/serve.ts:L140-L146'
---
<!-- context:generated:start -->
## Summary

This component is responsible for assembling and serving the context graph for visualization purposes, providing a local server for the Graft visualization tool. It handles the generation of JSON representations of the graph and manages client notifications for changes in the context directory.

## Related

- produces [[graph-representation]] — It produces visual representations of the graph structure.
- uses [[graph-traversal-and-analysis]] — It utilizes the graph traversal capabilities for visualization.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
