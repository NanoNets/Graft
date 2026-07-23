# src/graph/extract.ts · [[graph-extraction-and-loading]]

This file provides functionality to extract and represent code structure from source files into a standardized format for further processing.

- Language · type · L18-L18 — Defines a type representing the supported programming languages for extraction.
- languageOf · function · L21-L28 — Determines the programming language of a given file path based on its extension.
- RawEdge · interface · L34-L45 — Represents an unresolved edge in the code structure that will be resolved later during processing.
- ExtractResult · interface · L47-L50 — Holds the result of the extraction process, containing nodes and raw edges.
- searchBody · function · L67-L70 — Normalizes and truncates the body of a code definition for efficient searching.
- fileResidual · function · L78-L89 — Extracts the module-level residual content from a source file that is not covered by any symbol definitions.
- WalkCtx · interface · L136-L147 — Contextual information used during the traversal of the syntax tree for code extraction.
- DefDescriptor · interface · L150-L156 — Describes a code definition with its relevant metadata for extraction purposes.
- parseSource · function · L164-L166 — Parses the source code into a syntax tree while handling large files in manageable chunks.
- extractFile · function · L168-L209 — Extracts nodes and edges from a source file, representing its structure in a standardized format.
- walk · function · L211-L278 — Recursively traverses the syntax tree to collect definitions and their relationships.
- describe · function · L282-L313 — Identifies and describes the shape of code definitions based on their syntax tree representation.
- describeGo · function · L318-L356 — Describes Go-specific code definitions, including functions and methods, from the syntax tree.
- goReceiverType · function · L360-L366 — Extracts the base type name of a receiver for Go methods, if applicable.
- goExported · function · L370-L374 — Determines if a Go symbol is exported based on its naming convention.
- heritageEdges · function · L376-L403 — Generates edges representing class inheritance and implementation relationships.
- calleeName · function · L405-L428 — Extracts the name and context of a function call from the syntax tree, including receiver information.
- pyReceiver · function · L432-L441 — Identifies the receiver of a Python method call from its syntax tree representation.
- tsReceiver · function · L444-L454 — Identifies the receiver of a TypeScript method call from its syntax tree representation.
- isImport · function · L456-L461 — Determines if a syntax node represents an import statement in the code.
- importSpecifier · function · L463-L479 — Extracts the module path from an import statement in the syntax tree.
- clean · function · L482-L489 — Cleans and normalizes a function signature by removing unnecessary whitespace and punctuation.
- tsExported · function · L492-L499 — Checks if a node is exported based on its ancestor nodes in the syntax tree.
