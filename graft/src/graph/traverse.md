# src/graph/traverse.ts · [[graph-traversal-and-analysis]]

Centralizes the logic for resolving symbol queries in a graph, enabling consistent identification of nodes based on various naming conventions and paths.

- SymbolMatch · interface · L19-L21 — Represents a resolved match for a symbol search in the graph, allowing for future disambiguation of metadata.
- ResolveSymbolOptions · interface · L23-L26 — Defines options for narrowing down symbol resolution candidates based on path substring filtering.
- resolveSymbol · function · L47-L72 — Resolves a query string to all matching nodes in the graph, handling various naming conventions and fallbacks.
- symbolMatches · function · L74-L83 — Filters nodes in the graph to find matches based on a case-insensitive query, considering both name and id suffixes.
- EdgeHit · interface · L88-L93 — Represents a traversed edge in the graph, capturing the relationship and depth of the connection to a node.
- callersOf · function · L96-L104 — Finds all edges leading to a specified symbol, indicating which nodes directly call it.
- calleesOf · function · L107-L115 — Identifies all edges originating from a specified symbol, showing which nodes it directly calls.
- impactOf · function · L123-L125 — Performs a breadth-first search to determine the impact of changes to a symbol, identifying affected nodes up to a specified depth.
- impactOfMany · function · L141-L172 — Generalizes the impact analysis to multiple seed nodes, aggregating the results of their incoming edges.
- symbolsInFile · function · L176-L178 — Retrieves all symbols defined in a specific file, filtering out file nodes.
- impactOfFile · function · L189-L191 — Aggregates the impact analysis for a file node and its defined symbols, ensuring all dependents are considered.
