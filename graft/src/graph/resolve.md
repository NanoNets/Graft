# src/graph/resolve.ts

This file resolves raw edge intents into concrete edges by matching names against a node index, ensuring accurate relationships between nodes.

- GoModule · interface · L23-L26 — interface GoModule
- ResolveOptions · interface · L28-L33 — interface ResolveOptions
- resolveEdges · function · L35-L121 — This function processes raw edges and establishes relationships between nodes based on their types and specified relations.
- add · function · L81-L86 — This function adds a new edge to the output if it hasn't been seen before, preventing duplicate edges in the result.
- push · function · L123-L127 — This function adds a value to an array in a map, creating the array if it doesn't exist, facilitating grouped storage of nodes.
- resolveName · function · L133-L145 — This function resolves a symbol name to its corresponding node ID, prioritizing local matches and handling ambiguities appropriately.
- resolveTypedMember · function · L161-L194 — function resolveTypedMember( recvType: string, name: string, file: string, ownerMethod: Map<string, NodeV1[]>, classParents: Map<string, string[]>, ): { id: string; confidence: EdgeV1["confidence"] } | "ambiguous" | null
- resolveImport · function · L200-L212 — This function resolves a module specifier to a file node ID if it points within the repository, ensuring correct imports.
- resolveGoImport · function · L224-L239 — function resolveGoImport(spec: string, modules: GoModule[], filesByDir: Map<string, string[]>): string
