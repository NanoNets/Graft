# src/viz/assemble.ts

Assembles a comprehensive graph document from markdown files in a context directory, ensuring that only valid nodes and edges are included.

- VizNode · interface · L18-L24 — Defines the structure of a node in the visualization graph, encapsulating its identity and attributes.
- VizEdge · interface · L26-L31 — Defines the structure of an edge in the visualization graph, representing relationships between nodes.
- VizGraph · interface · L33-L42 — Encapsulates the complete visualization graph, including metadata about nodes and edges.
- normalizeRelation · function · L56-L58 — Maps legacy vague verbs to concrete verbs to maintain consistency in the graph's relationships.
- extractSummary · function · L65-L76 — Extracts and cleans the summary text from a markdown node's content, ensuring it adheres to length constraints.
- assembleContextGraph · function · L79-L130 — Processes markdown files in a specified directory to create a structured visualization graph, handling errors gracefully.
