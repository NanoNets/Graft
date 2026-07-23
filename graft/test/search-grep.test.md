# test/search-grep.test.ts

Contains core tests for the `graft grep` functionality, ensuring accurate symbol attribution and search results in a parsed graph.

- fileNode · function · L24-L39 — Creates a file node representation for a given path and number of lines, facilitating graph construction.
- graphOf · function · L41-L43 — Constructs a graph representation from nodes and edges, encapsulating metadata about the graph structure.
- needleRepo · function · L50-L85 — Sets up a temporary repository with TypeScript files to test the grep functionality, simulating real-world usage scenarios.
- loadBuiltGraph · function · L87-L91 — Loads a built graph from a specified repository, ensuring the graph is correctly constructed for testing.
