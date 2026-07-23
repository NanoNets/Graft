# src/mcp/tools.ts

- ToolDef · interface · L27-L31 — Defines the structure for tool definitions used in the MCP tools, ensuring consistent input schema and metadata for each tool.
- unknownSymbolText · function · L35-L37 — Generates an error message for an unknown symbol query, guiding users to check their input or build the graph.
- renderMatches · function · L129-L144 — Formats and renders the results of graph traversal matches, providing a structured output for users to understand symbol relationships.
- callWorkspaceTool · function · L150-L196 — function callWorkspaceTool( root: string, dirOverride: string | undefined, name: string, args: Record<string, unknown>, ): { text: string; isError: boolean } | null
- callTool · function · L198-L284 — Handles the invocation of various tools based on user input, managing errors and returning formatted results for different graph operations.
