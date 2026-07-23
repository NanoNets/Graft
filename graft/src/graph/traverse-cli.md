# src/graph/traverse-cli.ts · [[graph-traversal-and-analysis]]

This file implements CLI commands for traversing a graph to find callers, callees, and impact of symbols, ensuring a consistent user experience across different commands.

- CallersCliOptions · interface · L21-L30 — interface CallersCliOptions
- headerOf · function · L38-L40 — Generates a formatted header string for a node, providing essential information for display in CLI output.
- hitLine · function · L44-L49 — Formats a single hit line for display, showing the relationship and details of a node in the context of the traversal.
- callersSavings · function · L55-L65 — function callersSavings( graph: GraphV1, results: { symbol: NodeV1; hits: EdgeHit[] }[], ): Savings | undefined
- looseNoteFor · function · L68-L72 — Creates a user-friendly message when no edges are found for a symbol, guiding users on next steps.
- SymbolJson · interface · L74-L80 — Defines the structure for symbol metadata in JSON format, ensuring consistent representation of symbols in output.
- MatchJson · interface · L82-L86 — Defines the structure for matching results in JSON format, encapsulating symbol information and associated hits.
- HitJson · interface · L88-L96 — Defines the structure for hit details in JSON format, providing information about the relationship and depth of hits.
- symbolJson · function · L98-L100 — Converts a node into a standardized JSON format, facilitating consistent output for symbol information.
- hitJson · function · L102-L111 — Transforms an EdgeHit into a JSON format, ensuring structured output for hits in the traversal results.
- resolveDirection · function · L114-L119 — function resolveDirection(raw: string | undefined): Direction
- runCallersCommand · function · L127-L182 — function runCallersCommand(query: string, dir: string, opts: CallersCliOptions): void
