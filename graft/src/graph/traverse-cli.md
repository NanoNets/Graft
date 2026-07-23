# src/graph/traverse-cli.ts · [[graph-traversal-and-analysis]]

This file implements CLI commands for traversing a graph to find callers, callees, and impact of symbols, ensuring a consistent user experience across different commands.

- TraverseKind · type · L17-L17 — Defines the types of traversal operations available for graph navigation, ensuring type safety in CLI commands.
- TraverseCliOptions · interface · L19-L26 — Specifies options for the CLI traversal commands, allowing customization of input, output format, and traversal depth.
- edgesFor · function · L31-L35 — Determines the edges to traverse in the graph based on the specified kind, facilitating the retrieval of relevant connections for a node.
- headerOf · function · L41-L43 — Generates a formatted header string for a node, providing essential information for display in CLI output.
- hitLine · function · L45-L50 — Formats a single hit line for display, showing the relationship and details of a node in the context of the traversal.
- looseNoteFor · function · L54-L58 — Creates a user-friendly message when no edges are found for a symbol, guiding users on next steps.
- SymbolJson · interface · L60-L66 — Defines the structure for symbol metadata in JSON format, ensuring consistent representation of symbols in output.
- MatchJson · interface · L68-L72 — Defines the structure for matching results in JSON format, encapsulating symbol information and associated hits.
- HitJson · interface · L74-L82 — Defines the structure for hit details in JSON format, providing information about the relationship and depth of hits.
- symbolJson · function · L84-L86 — Converts a node into a standardized JSON format, facilitating consistent output for symbol information.
- hitJson · function · L88-L97 — Transforms an EdgeHit into a JSON format, ensuring structured output for hits in the traversal results.
- runTraverseCommand · function · L105-L155 — Executes the traversal command based on user input, handling graph resolution and output formatting, while managing errors effectively.
