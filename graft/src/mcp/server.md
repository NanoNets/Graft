# src/mcp/server.ts

Defines a minimal JSON-RPC 2.0 server for handling protocol messages and tool calls.

- send · function · L8-L10 — Sends a JSON-RPC message to the standard output stream.
- reply · function · L12-L14 — Constructs and sends a successful JSON-RPC response message.
- replyError · function · L16-L18 — Constructs and sends a JSON-RPC error response message.
- startMcpServer · function · L20-L66 — Initializes the server to listen for incoming JSON-RPC messages and handle them appropriately.
