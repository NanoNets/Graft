# src/viz/serve.ts · [[visualization-and-serving]]

This file implements a local server for serving a viewer and handling API requests related to context and code graphs.

- VizServerOptions · interface · L16-L21 — Defines the configuration options required to start the visualization server.
- VizServer · interface · L23-L26 — Represents the visualization server with its URL and a method to close it.
- sendJson · function · L38-L41 — Sends a JSON response with the specified status and body to the client.
- listen · function · L43-L55 — Attempts to bind the server to a specified port, handling errors if the port is in use.
- onError · function · L45-L48 — Handles errors that occur when trying to bind the server to a port.
- startVizServer · function · L57-L148 — Initializes and starts the visualization server, setting up routes and handling requests.
- close · method · L140-L146 — Closes the visualization server and cleans up resources.
