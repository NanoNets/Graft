# src/graph/bindings.ts

This file implements a binding pass that resolves variable types in a parsed file, enabling accurate type lookups for local variables, parameters, and class fields during code analysis.

- FileBindings · class · L18-L33 — Manages the mapping of variable/field names to their types within different scopes, enabling type resolution during code analysis.
- set · method · L21-L23 — Records the type of a variable or field in the specified scope, allowing for later retrieval during type resolution.
- lookup · method · L26-L32 — Retrieves the type associated with a variable or field name from the closest matching scope, facilitating type resolution in nested contexts.
- defName · function · L45-L77 — Determines the name of a definition node (like a function or class) based on its syntax, aiding in the identification of types during analysis.
- goReceiverVarOf · function · L81-L85 — Extracts the variable name of the receiver parameter from a Go method node, which is essential for understanding method context.
- goReceiverTypeOf · function · L91-L97 — Determines the base type of a receiver in a Go method, which is crucial for type resolution in method calls.
- resolveRecvType · function · L103-L121 — Resolves the type of a receiver in a method call based on the current context, ensuring accurate type information is used during analysis.
- isClassNode · function · L123-L129 — Checks if a given node represents a class definition, which is important for understanding the structure of the code being analyzed.
- collectBindings · function · L132-L138 — Traverses a parsed syntax tree to gather variable-to-type bindings, which are essential for type resolution in the codebase.
- collectAliases · function · L142-L156 — Scans the syntax tree to collect import aliases, ensuring that type resolution accounts for aliased names in the code.
- visit · function · L162-L182 — Recursively processes nodes in the syntax tree to build up type bindings and scopes, facilitating comprehensive type analysis.
- resolveAlias · function · L188-L190 — Resolves a name through the collected aliases, ensuring that type lookups are accurate even when using aliased names.
- pyTypeName · function · L192-L200 — Extracts and resolves the type name from a Python node, which is necessary for accurate type binding in Python code.
- callTypeName · function · L202-L207 — Determines the type name from a call expression, which is important for understanding the types of function calls in the code.
- handlePy · function · L209-L239 — Handles the processing of Python nodes to extract type information, contributing to the overall type resolution process.
- tsAnnotationTypeName · function · L241-L248 — Extracts the type name from TypeScript annotation nodes, which is crucial for type resolution in TypeScript code.
- tsNewTypeName · function · L250-L255 — Determines the type name from a TypeScript new expression, aiding in the resolution of types during analysis.
- handleTs · function · L257-L285 — Processes TypeScript nodes to gather type information, which is essential for accurate type resolution in TypeScript code.
- handleGo · function · L287-L322 — Handles the processing of Go nodes to extract type information, ensuring that type resolution is accurate for Go code.
