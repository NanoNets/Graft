# src/graph/types.ts

Defines the schema for a code graph, outlining nodes and edges for code structure representation.

- Kind · type · L15-L23 — Enumerates the types of symbols that can exist in the code graph, facilitating type identification.
- Confidence · type · L26-L26 — Specifies the confidence levels for the truth of edges in the graph, aiding in the assessment of relationships.
- SummaryState · type · L29-L29 — Indicates whether the meaning-layer has been computed for a node, managing the state of node summaries.
- Crux · interface · L33-L36 — Holds the LLM-chosen business-logic excerpt for a node, providing a source of truth for code interpretation.
- NodeV1 · interface · L38-L63 — Represents a node in the graph with its identity, location, and meaning, essential for graph construction.
- Relation · type · L65-L71 — Defines the types of relationships between nodes in the graph, clarifying how symbols interact.
- EdgeV1 · interface · L73-L78 — Describes the edges connecting nodes in the graph, detailing the source, target, and relationship type.
- GraphV1 · interface · L80-L89 — Encapsulates the entire graph structure, including metadata and collections of nodes and edges.
