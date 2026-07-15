# src/graph/resolve.ts · [[context-graph-management]]

This file resolves raw edge intents into concrete edges by matching names against a node index, ensuring accurate relationships between nodes.

- resolveEdges · function · L20-L58 — This function processes raw edges and establishes relationships between nodes based on their types and specified relations.
- add · function · L34-L39 — This function adds a new edge to the output if it hasn't been seen before, preventing duplicate edges in the result.
- push · function · L60-L64 — This function adds a value to an array in a map, creating the array if it doesn't exist, facilitating grouped storage of nodes.
- resolveName · function · L70-L82 — This function resolves a symbol name to its corresponding node ID, prioritizing local matches and handling ambiguities appropriately.
- resolveImport · function · L88-L100 — This function resolves a module specifier to a file node ID if it points within the repository, ensuring correct imports.
