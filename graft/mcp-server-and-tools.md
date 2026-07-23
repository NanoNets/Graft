---
name: MCP Server and Tools
slug: mcp-server-and-tools
type: system
sources:
  - path: test/mcp-server.test.ts
    hash: 4d828181f0a8c645f00097ab43c2bdcf5bc65da276e83b7503bc2888ae09f254
  - path: test/mcp-tools.test.ts
    hash: 22d3a32a85a0ba1542969786e8bda07d3df02ee068554d4070f705d30d7239dc
sources_digest: 57fc202e973b1af8d9bf326a11a5008fb7c95c9ea5738c7dfecd511a8df4d9d0
links:
  - to: graph-serialization
    relation: validates
    description: The MCP tools may validate the integrity of the serialized graph data.
generator:
  version: 1
covers:
  - symbol: rpc
    kind: function
    at: 'test/mcp-server.test.ts:L9-L28'
  - symbol: builtRepo
    kind: function
    at: 'test/mcp-tools.test.ts:L9-L16'
  - symbol: chainRepo
    kind: function
    at: 'test/mcp-tools.test.ts:L22-L33'
  - symbol: customDirRepo
    kind: function
    at: 'test/mcp-tools.test.ts:L37-L45'
  - symbol: fileScopeRepo
    kind: function
    at: 'test/mcp-tools.test.ts:L50-L60'
  - symbol: multiDirRepo
    kind: function
    at: 'test/mcp-tools.test.ts:L65-L73'
---
<!-- context:generated:start -->
## Summary

This component encompasses the Multi-Channel Protocol server and associated tools, facilitating RPC interactions and providing various utilities for analyzing and manipulating code repositories.

## Related

- validates [[graph-serialization]] — The MCP tools may validate the integrity of the serialized graph data.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
