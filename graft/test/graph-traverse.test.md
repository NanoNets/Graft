# test/graph-traverse.test.ts · [[graph-traversal-and-impact-analysis]]

Contains tests for graph traversal functionalities, ensuring correct symbol resolution and edge walking behavior.

- nodeStub · function · L15-L30 — Creates a stub node for testing purposes, encapsulating essential properties of a NodeV1 object.
- edge · function · L32-L34 — Constructs an edge between two nodes in the graph, defining their relationship type.
- graphOf · function · L36-L42 — Generates a graph structure from an array of nodes and edges, encapsulating metadata about the graph.
- baseGraph · function · L57-L66 — Creates a base graph fixture used for testing symbol resolution and edge walking.
- diamondGraph · function · L167-L179 — Constructs a diamond-shaped graph for testing the impact of nodes based on incoming edges.
- fileAndSymbolGraph · function · L221-L231 — Creates a graph that includes both file and symbol nodes to test their interactions in dependency resolution.
