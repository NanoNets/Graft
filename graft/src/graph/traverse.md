# src/graph/traverse.ts · [[graph-traversal-and-analysis]]

Centralizes the logic for resolving symbol queries in a graph, enabling consistent identification of nodes based on various naming conventions and paths.

- Direction · type · L21-L21 — type Direction = "in" | "out";
- SymbolMatch · interface · L25-L27 — Represents a resolved match for a symbol search in the graph, allowing for future disambiguation of metadata.
- ResolveSymbolOptions · interface · L29-L32 — Defines options for narrowing down symbol resolution candidates based on path substring filtering.
- resolveSymbol · function · L53-L78 — Resolves a query string to all matching nodes in the graph, handling various naming conventions and fallbacks.
- symbolMatches · function · L80-L89 — Filters nodes in the graph to find matches based on a case-insensitive query, considering both name and id suffixes.
- EdgeHit · interface · L94-L99 — Represents a traversed edge in the graph, capturing the relationship and depth of the connection to a node.
- callersOf · function · L102-L110 — Finds all edges leading to a specified symbol, indicating which nodes directly call it.
- calleesOf · function · L113-L121 — Identifies all edges originating from a specified symbol, showing which nodes it directly calls.
- impactOf · function · L129-L131 — Performs a breadth-first search to determine the impact of changes to a symbol, identifying affected nodes up to a specified depth.
- impactOfMany · function · L149-L184 — Generalizes the impact analysis to multiple seed nodes, aggregating the results of their incoming edges.
- symbolsInFile · function · L188-L190 — Retrieves all symbols defined in a specific file, filtering out file nodes.
- impactOfFile · function · L201-L203 — Aggregates the impact analysis for a file node and its defined symbols, ensuring all dependents are considered.
- edgeWalk · function · L218-L222 — function edgeWalk(graph: GraphV1, node: NodeV1, direction: Direction, depth: number): EdgeHit[]
