# test/graph-go.test.ts · [[testing-and-validation]]

This file contains tests for verifying the extraction of Go code structures and their relationships in a code graph.

- makeFixture · function · L53-L60 — Creates a temporary Go module directory with necessary files for testing graph extraction.
- nodeById · function · L62-L64 — Retrieves a node from the graph by its unique identifier, facilitating graph traversal and assertions in tests.
