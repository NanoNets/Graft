# src/graph/resolve.ts · [[graph-extraction-and-loading]]

This module resolves various types of edges between nodes in a codebase, ensuring accurate connections based on defined relationships and confidence levels.

- GoModule · interface · L39-L42 — Defines the structure for a Go module, enabling the mapping of Go import paths to their corresponding directories in the repository.
- ResolveOptions · interface · L44-L49 — Specifies options for resolving edges, including the Go modules present in the repository for accurate import path mapping.
- resolveEdges · function · L51-L140 — Processes nodes and raw edges to create a list of resolved edges, ensuring accurate relationships based on various resolution strategies.
- add · function · L97-L102 — Adds a new edge to the output if it hasn't been seen before, preventing duplicates in the resolved edges list.
- push · function · L142-L146 — This function adds a value to an array in a map, creating the array if it doesn't exist, facilitating grouped storage of nodes.
- resolveName · function · L152-L164 — This function resolves a symbol name to its corresponding node ID, prioritizing local matches and handling ambiguities appropriately.
- resolveTypedMember · function · L180-L213 — Resolves a typed member call against a method index, traversing the inheritance chain to find the appropriate method or returning ambiguity if necessary.
- resolveImport · function · L219-L231 — This function resolves a module specifier to a file node ID if it points within the repository, ensuring correct imports.
- resolveGoImport · function · L243-L258 — Maps a Go import package path to an in-repo file node, handling module paths and ensuring correct resolution within the repository structure.
