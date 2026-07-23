# test/graphrank.test.ts · [[graph-ranking]]

This file contains unit and integration tests for the personalizedPageRank function, ensuring it correctly ranks nodes based on their connectivity in a graph.

- node · function · L23-L38 — Creates a node representation for the graph with specified properties.
- edge · function · L39-L41 — Defines an edge between two nodes in the graph, establishing a relationship.
- graphOf · function · L42-L48 — Constructs a graph object from given nodes and edges, encapsulating their relationships.
- makeCollisionFixture · function · L182-L192 — Sets up a temporary file structure to simulate a collision scenario for testing graph ranking.
- rank · function · L194-L195 — Executes the ask function with specified parameters to retrieve ranked results based on graph connectivity.
