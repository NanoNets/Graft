# src/graph/resolve.ts

This file resolves raw edge intents into concrete edges by matching names against a node index, ensuring accurate relationships between nodes.

- GoModule · interface · L39-L42 — interface GoModule
- ResolveOptions · interface · L44-L49 — interface ResolveOptions
- resolveEdges · function · L51-L140 — This function processes raw edges and establishes relationships between nodes based on their types and specified relations.
- add · function · L97-L102 — This function adds a new edge to the output if it hasn't been seen before, preventing duplicate edges in the result.
- push · function · L142-L146 — This function adds a value to an array in a map, creating the array if it doesn't exist, facilitating grouped storage of nodes.
- resolveName · function · L152-L164 — This function resolves a symbol name to its corresponding node ID, prioritizing local matches and handling ambiguities appropriately.
- resolveTypedMember · function · L180-L213 — function resolveTypedMember( recvType: string, name: string, file: string, ownerMethod: Map<string, NodeV1[]>, classParents: Map<string, string[]>, ): { id: string; confidence: EdgeV1["confidence"] } | "ambiguous" | null
- resolveImport · function · L219-L231 — This function resolves a module specifier to a file node ID if it points within the repository, ensuring correct imports.
- resolveGoImport · function · L243-L258 — function resolveGoImport(spec: string, modules: GoModule[], filesByDir: Map<string, string[]>): string
