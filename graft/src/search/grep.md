# src/search/grep.ts · [[graph-traversal-and-analysis]]

This file implements a regex search over indexed files in a graph, grouping results by their enclosing symbols and ranking them by their importance based on incoming edges.

- GrepHit · interface · L18-L22 — Represents a single hit found during the grep search, including the line number and trimmed text of the line.
- GrepSymbolRef · interface · L24-L32 — Defines a reference to a symbol in the graph, including its qualified name and span, to facilitate grouping grep hits by their enclosing symbols.
- GrepGroup · interface · L34-L43 — Groups grep hits by their enclosing symbol, providing context such as the symbol's in-degree and the path of the file.
- GrepResult · interface · L45-L62 — Encapsulates the results of a grep operation, including the pattern searched, total hits, and grouped results.
- GrepOptions · interface · L64-L73 — Holds options for configuring the grep search, such as case sensitivity and maximum hits to collect.
- escapeRegExp · function · L79-L81 — Escapes special characters in a string to create a safe regex pattern for searching.
- spanBounds · function · L83-L87 — Extracts the start and end line numbers from a span string, returning null if the format is invalid.
- SymbolSpan · interface · L89-L93 — Represents a span of a symbol in the graph, including its start and end lines, to assist in finding enclosing symbols.
- symbolsOf · function · L97-L106 — Retrieves and sorts the symbols of a given file in the graph, based on their span start lines.
- enclosingSymbol · function · L112-L119 — Finds the innermost symbol that contains a specified line number, returning the corresponding node from the graph.
- computeInDegree · function · L123-L130 — Calculates the incoming edge count for each symbol in the graph, which is used to rank grep hits by importance.
- toSymbolRef · function · L132-L135 — Converts a node in the graph to a GrepSymbolRef, providing a structured representation of the symbol.
- grepGraph · function · L137-L200 — Performs the grep search on the graph, collecting and returning results based on the specified pattern and options.
