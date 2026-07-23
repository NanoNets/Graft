# src/graph/types.ts · [[graph-extraction-and-loading]] [[graph-representation]]

Defines the structure and relationships of a code graph schema, facilitating the representation of code elements and their interactions.

- Kind · type · L15-L23 — Enumerates the various types of nodes in the code graph, ensuring consistent categorization of code elements across different languages.
- Confidence · type · L26-L26 — Specifies the confidence levels for the truth of edges in the graph, aiding in the assessment of relationships.
- SummaryState · type · L29-L29 — Indicates whether the meaning-layer has been computed for a node, managing the state of node summaries.
- Crux · interface · L33-L36 — Holds the LLM-chosen business-logic excerpt for a node, providing a source of truth for code interpretation.
- NodeV1 · interface · L38-L63 — Describes the properties of a node in the code graph, encapsulating its identity, location, and meaning for effective graph representation.
- Relation · type · L65-L71 — Defines the types of relationships between nodes in the graph, clarifying how symbols interact.
- EdgeV1 · interface · L73-L78 — Describes the edges connecting nodes in the graph, detailing the source, target, and relationship type.
- ScopeV1 · interface · L84-L88 — interface ScopeV1
- GraphV1 · interface · L90-L102 — Encapsulates the entire graph structure, including metadata and collections of nodes and edges.
