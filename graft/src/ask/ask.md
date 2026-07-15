# src/ask/ask.ts

This file implements a query routing tool that processes natural language queries to return relevant context from a codebase.

- AskHit · interface · L23-L32 — Represents a hit in the query results, encapsulating details about a concept or symbol found in the codebase.
- AskResult · interface · L34-L41 — Encapsulates the result of a query, including the query string, mode of operation, and the hits found.
- tokenize · function · L50-L56 — Transforms a string of text into an array of lowercased subword tokens, filtering out common stop words.
- counts · function · L59-L63 — Creates a frequency count map of tokens, allowing for analysis of term occurrences in a document.
- firstProse · function · L66-L73 — Extracts the first meaningful prose line from a body of text, ignoring headings and blank lines.
- Corpus · interface · L75-L78 — Defines the structure for a corpus containing concepts and a graph, used for processing queries.
- loadCorpus · function · L80-L105 — Loads a corpus from a specified directory, extracting concepts and building a graph for query processing.
- score · function · L108-L115 — Calculates a score for a document's token counts against a query, facilitating relevance ranking.
- findSubject · function · L125-L143 — Identifies the most relevant symbols in the graph that match the query, prioritizing exact name matches.
- structural · function · L145-L186 — Processes a structural query to find and return relevant callers or callees from the graph based on the query.
- lexical · function · L190-L234 — Ranks concepts and symbols based on lexical matching with the query, returning the most relevant results.
- AskOptions · interface · L236-L239 — Defines options for the ask function, allowing customization of the query context and result limits.
- ask · function · L242-L252 — Handles a query by loading the appropriate corpus and executing either structural or lexical search.
- formatAsk · function · L255-L276 — Formats the results of an AskResult into a markdown string for easy presentation.
