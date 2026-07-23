# viewer/data.ts · [[graph-visualization]]

This file defines data structures and functions for managing and visualizing graph data from a server.

- VizNode · interface · L6-L12 — Represents a node in the visualization graph, encapsulating its identity and metadata.
- VizEdge · interface · L14-L20 — Defines the relationship between two nodes in the visualization graph, including its type and description.
- VizGraph · interface · L22-L26 — Encapsulates the entire visualization graph structure, including its nodes and edges.
- Family · type · L29-L29 — Categorizes relation verbs into families to enforce consistent semantics in graph relationships.
- famOf · function · L39-L41 — Determines the family category of a given relation verb, defaulting to 'association' if unknown.
- chipKey · function · L47-L51 — Generates a key for chip grouping based on the relation verb, simplifying the visualization of relationships.
- colorToken · function · L72-L75 — Maps a type to its corresponding CSS custom property for styling in the visualization.
- cvar · function · L77-L79 — Retrieves the value of a CSS custom property from the document's root element.
- loadContextGraph · function · L81-L84 — Fetches the context graph data from the server and returns it in a structured format.
- CodeGraphV1 · interface · L86-L93 — Defines the structure of the code graph data received from the server, including nodes and edges.
- loadCodeGraph · function · L96-L113 — Loads the code graph from the server, filtering out unresolved edges and returning a structured graph.
- onServerChange · function · L116-L121 — Subscribes to server events to trigger updates in the application when changes occur.
