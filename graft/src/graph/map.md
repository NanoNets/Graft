# src/graph/map.ts

Builds a structured representation of a repository's file and symbol organization based on their relationships, facilitating easier navigation and understanding of the codebase.

- Hub · interface · L26-L32 — Defines the structure of a hub in the repository map, capturing its essential attributes for identification and ranking.
- DirEntry · interface · L34-L40 — Represents a directory entry in the repository map, summarizing its contents and associated hubs for better navigation.
- RepoMap · interface · L42-L53 — Encapsulates the entire repository map structure, providing a comprehensive overview of files, symbols, and their relationships.
- BuildRepoMapOptions · interface · L55-L62 — Specifies options for building the repository map, allowing customization of directory and hub limits.
- dirKey · function · L74-L77 — Generates a directory key based on the specified depth, facilitating the grouping of files in the repository map.
- computeInDegree · function · L82-L89 — Calculates the in-degree of nodes in the graph, determining the number of incoming edges for each target, which is crucial for identifying hubs.
- topHubs · function · L94-L100 — Identifies the top hubs based on in-degree, ensuring that only significant nodes are included in the repository map.
- sortedLanguages · function · L102-L109 — Sorts and deduplicates the programming languages used in the repository, enhancing the metadata of the repository map.
- buildRepoMap · function · L116-L185 — Constructs the repository map from a given graph, organizing files and symbols into a structured format for easy access.
- depthFor · function · L141-L141 — Determines the depth for a given path, influencing how files are grouped in the repository map based on the split segment.
- basenameOf · function · L189-L192 — Extracts the base name from a file path, simplifying the representation of file names in the output.
- formatDirHub · function · L194-L196 — Formats a hub's information for display, providing a user-friendly representation of its attributes.
- formatDirLine · function · L198-L203 — Formats a directory entry for display, summarizing its contents and associated hubs in a readable format.
- formatHotspot · function · L205-L207 — Formats a hotspot's information for display, detailing its attributes in a clear manner.
- formatRepoMap · function · L215-L229 — Renders the repository map as a human-readable string, summarizing its contents and structure for easy understanding.
