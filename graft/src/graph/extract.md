# src/graph/extract.ts

This module extracts structured data from source files into a normalized format for further processing.

- Language · type · L18-L18 — Defines the supported programming languages for extraction.
- languageOf · function · L21-L28 — Determines the programming language of a given file path.
- RawEdge · interface · L34-L45 — Represents an unresolved edge in the extraction process, linking nodes in the graph.
- ExtractResult · interface · L47-L50 — Holds the result of the extraction process, containing nodes and raw edges.
- searchBody · function · L67-L70 — function searchBody(text: string, max = MAX_BODY_CHARS): string
- fileResidual · function · L78-L89 — function fileResidual(source: string, symbols: NodeV1[]): string
- WalkCtx · interface · L136-L147 — Context for walking through the syntax tree during extraction, maintaining state and scope.
- DefDescriptor · interface · L150-L156 — Describes a definition in the syntax tree, including its name and type.
- parseSource · function · L164-L166 — function parseSource(source: string): Parser.SyntaxNode
- extractFile · function · L168-L209 — Extracts nodes and edges from a source file based on its syntax tree.
- walk · function · L211-L278 — Recursively traverses the syntax tree to collect definitions and their relationships.
- describe · function · L282-L313 — Identifies and describes definitions in the syntax tree based on their node types.
- describeGo · function · L318-L356 — function describeGo(node: Parser.SyntaxNode, _ctx: WalkCtx): DefDescriptor | null
- goReceiverType · function · L360-L366 — function goReceiverType(node: Parser.SyntaxNode): string | null
- goExported · function · L370-L374 — function goExported(name: string): boolean
- heritageEdges · function · L376-L403 — Generates edges representing class inheritance and implementation relationships.
- calleeName · function · L405-L428 — Extracts the name of a function or method being called in the syntax tree.
- pyReceiver · function · L432-L441 — function pyReceiver(fn: Parser.SyntaxNode): string | undefined
- tsReceiver · function · L444-L454 — function tsReceiver(fn: Parser.SyntaxNode): string | undefined
- isImport · function · L456-L461 — Determines if a node represents an import statement in the syntax tree.
- importSpecifier · function · L463-L479 — Extracts the module name from an import statement in the syntax tree.
- clean · function · L482-L489 — Cleans and normalizes a function signature by removing unnecessary whitespace and punctuation.
- tsExported · function · L492-L499 — Checks if a node is exported based on its ancestor nodes in the syntax tree.
