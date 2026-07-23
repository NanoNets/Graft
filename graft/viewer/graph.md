# viewer/graph.ts · [[graph-visualization]] [[user-interaction-in-visualization]]

This file implements a force-directed graph visualization using D3.js, allowing interactive exploration of nodes and edges.

- SimNode · interface · L22-L30 — Defines the structure of a node in the simulation, including its position and properties.
- SimEdge · interface · L32-L38 — Defines the structure of an edge in the simulation, representing the relationship between two nodes.
- el · function · L42-L46 — Creates and returns an SVG element with specified attributes, facilitating dynamic SVG generation.
- GraphView · class · L48-L334 — Manages the rendering and interaction of the graph view, including node and edge updates.
- constructor · method · L65-L69 — Initializes the GraphView instance and sets up the SVG environment for rendering.
- buildChrome · method · L71-L78 — Sets up the initial SVG structure for the graph, including definitions and viewport.
- ensureMarkers · method · L80-L91 — Ensures that the necessary SVG markers for edges are created and available for rendering.
- setData · method · L94-L136 — Loads a new dataset into the graph, updating node positions and relationships accordingly.
- buildElements · method · L138-L164 — Constructs the SVG elements for nodes and edges based on the current dataset.
- tick · method · L166-L182 — Updates the positions of nodes and edges on each simulation tick, ensuring the graph remains interactive.
- restyle · method · L185-L243 — Applies styles to nodes and edges based on their visibility and selection state.
- nodeShown · function · L195-L195 — Determines if a node should be displayed based on its type and visibility settings.
- select · method · L245-L249 — Selects a node in the graph and updates the visual representation accordingly.
- focus · method · L252-L261 — Centers the view on a specified node, enhancing its visibility and selection.
- firstMatch · method · L263-L266 — Finds the first node that matches the current query, facilitating search functionality.
- applyView · method · L268-L270 — Applies the current view transformation to the graph, adjusting the viewport accordingly.
- zoomBy · method · L272-L279 — Adjusts the zoom level of the graph view based on user input, allowing for detailed exploration.
- resetView · method · L281-L284 — Resets the graph view to its initial state, centering and scaling the view.
- reheat · method · L286-L288 — Restarts the simulation with increased alpha, making the graph more dynamic.
- bindDrag · method · L290-L309 — Enables dragging functionality for nodes, allowing users to reposition them interactively.
- move · function · L294-L299 — Handles the movement of a node during drag events, updating its fixed position.
- up · function · L300-L305 — Finalizes the drag operation by releasing the node's fixed position.
- bindPanZoom · method · L311-L333 — Sets up event listeners for panning and zooming the graph view based on user interactions.
