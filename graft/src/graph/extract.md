# src/graph/extract.ts · [[context-graph-management]]

This module extracts structured data from source files into a normalized format for further processing.

- Language · type · L16-L16 — Defines the supported programming languages for extraction.
- languageOf · function · L19-L25 — Determines the programming language of a given file path.
- RawEdge · interface · L31-L39 — Represents an unresolved edge in the extraction process, linking nodes in the graph.
- ExtractResult · interface · L41-L44 — Holds the result of the extraction process, containing nodes and raw edges.
- WalkCtx · interface · L76-L84 — Context for walking through the syntax tree during extraction, maintaining state and scope.
- DefDescriptor · interface · L87-L92 — Describes a definition in the syntax tree, including its name and type.
- extractFile · function · L94-L127 — Extracts nodes and edges from a source file based on its syntax tree.
- walk · function · L129-L181 — Recursively traverses the syntax tree to collect definitions and their relationships.
- describe · function · L184-L213 — Identifies and describes definitions in the syntax tree based on their node types.
- heritageEdges · function · L215-L242 — Generates edges representing class inheritance and implementation relationships.
- calleeName · function · L244-L260 — Extracts the name of a function or method being called in the syntax tree.
- isImport · function · L262-L264 — Determines if a node represents an import statement in the syntax tree.
- importSpecifier · function · L266-L277 — Extracts the module name from an import statement in the syntax tree.
- clean · function · L280-L287 — Cleans and normalizes a function signature by removing unnecessary whitespace and punctuation.
- tsExported · function · L290-L297 — Checks if a node is exported based on its ancestor nodes in the syntax tree.
