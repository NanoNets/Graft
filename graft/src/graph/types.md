# src/graph/types.ts · [[context-graph-management]]

Defines the schema for a code graph, outlining nodes and edges for code structure representation.

- Kind · type · L15-L22 — Enumerates the types of symbols that can exist in the code graph, facilitating type identification.
- Confidence · type · L25-L25 — Specifies the confidence levels for the truth of edges in the graph, aiding in the assessment of relationships.
- SummaryState · type · L28-L28 — Indicates whether the meaning-layer has been computed for a node, managing the state of node summaries.
- Crux · interface · L32-L35 — Holds the LLM-chosen business-logic excerpt for a node, providing a source of truth for code interpretation.
- NodeV1 · interface · L37-L55 — Represents a node in the graph with its identity, location, and meaning, essential for graph construction.
- Relation · type · L57-L63 — Defines the types of relationships between nodes in the graph, clarifying how symbols interact.
- EdgeV1 · interface · L65-L70 — Describes the edges connecting nodes in the graph, detailing the source, target, and relationship type.
- GraphV1 · interface · L72-L81 — Encapsulates the entire graph structure, including metadata and collections of nodes and edges.
