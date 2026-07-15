# viewer/main.ts · [[graph-visualization]]

This file serves as the entry point for the graft visualization viewer, managing the user interface and interactions for displaying graphs.

- Tab · type · L10-L10 — Defines the possible tab types for the viewer, ensuring that only valid tab selections are made.
- $ · function · L12-L12 — Provides a type-safe way to retrieve HTML elements by their ID, enhancing code readability and reducing errors.
- activeGraph · function · L23-L25 — Determines which graph is currently active based on the selected tab, facilitating the correct data display.
- graphTab · function · L27-L29 — Identifies the current graph tab, ensuring the correct context is used for rendering and interactions.
- renderChips · function · L32-L60 — Generates and displays interactive chips for graph edges, allowing users to filter and manage edge visibility.
- rank · function · L43-L43 — Establishes a ranking system for edge types to ensure they are displayed in a meaningful order.
- glyphFor · function · L62-L71 — Maps edge types to their corresponding visual glyphs, enhancing the graphical representation of relationships.
- renderLegend · function · L74-L94 — Creates a legend for node types in the graph, providing users with context about the displayed data.
- updateShownCount · function · L96-L101 — Updates the displayed count of visible nodes in the graph, helping users understand the current view's scope.
- updateCounts · function · L103-L112 — Refreshes the displayed counts of nodes and edges based on the active graph, ensuring accurate information is presented.
- showDetail · function · L115-L124 — Displays detailed information about a selected graph element, enhancing user interaction and understanding.
- setTab · function · L129-L167 — Handles the logic for switching between different graph views, ensuring the UI reflects the current context accurately.
- showEmpty · function · L169-L173 — Displays a message when no graph data is available, guiding users on how to generate the necessary data.
- loadAll · function · L216-L223 — Loads the context and code graphs asynchronously, ensuring the viewer is populated with the latest data.
