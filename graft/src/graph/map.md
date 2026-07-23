# src/graph/map.ts

Builds a structured representation of a repository's file and symbol organization based on their relationships, facilitating easier navigation and understanding of the codebase.

- Hub · interface · L27-L33 — Defines the structure of a hub in the repository map, capturing its essential attributes for identification and ranking.
- DirEntry · interface · L35-L41 — Represents a directory entry in the repository map, summarizing its contents and associated hubs for better navigation.
- ScopeGroup · interface · L46-L53 — interface ScopeGroup
- RepoMap · interface · L55-L75 — Encapsulates the entire repository map structure, providing a comprehensive overview of files, symbols, and their relationships.
- BuildRepoMapOptions · interface · L77-L84 — Specifies options for building the repository map, allowing customization of directory and hub limits.
- dirKey · function · L96-L99 — Generates a directory key based on the specified depth, facilitating the grouping of files in the repository map.
- computeInDegree · function · L104-L111 — Calculates the in-degree of nodes in the graph, determining the number of incoming edges for each target, which is crucial for identifying hubs.
- topHubs · function · L116-L122 — Identifies the top hubs based on in-degree, ensuring that only significant nodes are included in the repository map.
- sortedLanguages · function · L124-L131 — Sorts and deduplicates the programming languages used in the repository, enhancing the metadata of the repository map.
- computeDirEntries · function · L144-L206 — function computeDirEntries( nodes: NodeV1[], inDegree: Map<string, number>, maxDirs: number, hubsPerDir: number, stripPrefix: string, ): { dirs: DirEntry[]; dropped: number }
- relPath · function · L154-L155 — relPath = (path: string): string
- depthFor · function · L175-L175 — depthFor = (rp: string): number
- fullPath · function · L191-L192 — fullPath = (relKey: string): string
- buildRepoMap · function · L219-L269 — Constructs the repository map from a given graph, organizing files and symbols into a structured format for easy access.
- basenameOf · function · L273-L276 — Extracts the base name from a file path, simplifying the representation of file names in the output.
- formatDirHub · function · L278-L280 — Formats a hub's information for display, providing a user-friendly representation of its attributes.
- formatDirLine · function · L282-L287 — Formats a directory entry for display, summarizing its contents and associated hubs in a readable format.
- formatHotspot · function · L289-L291 — Formats a hotspot's information for display, detailing its attributes in a clear manner.
- droppedNote · function · L294-L297 — function droppedNote(dropped: number): string | null
- formatRepoMap · function · L305-L330 — Renders the repository map as a human-readable string, summarizing its contents and structure for easy understanding.
