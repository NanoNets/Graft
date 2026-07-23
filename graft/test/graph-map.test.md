# test/graph-map.test.ts · [[testing-and-validation]]

This file contains tests for the `buildRepoMap` and `formatRepoMap` functions, ensuring they correctly process and format repository data.

- fileNode · function · L16-L31 — Creates a file node representation for the graph, encapsulating file metadata for processing.
- symNode · function · L33-L49 — Generates a symbol node representation for the graph, allowing for the inclusion of function or variable symbols with associated metadata.
- edge · function · L51-L53 — Defines a connection between two nodes in the graph, representing relationships such as function calls.
- graphOf · function · L55-L61 — Constructs a graph structure from nodes and edges, serving as the foundational data for repository mapping.
- graphOfWithScopes · function · L66-L70 — function graphOfWithScopes(nodes: NodeV1[], edges: EdgeV1[], scopes: ScopeV1[]): GraphV1
- twoScopeFixture · function · L249-L264 — function twoScopeFixture(): GraphV1
- bigFixture · function · L381-L400 — Creates a large fixture graph for testing, simulating a repository with multiple directories and symbols.
