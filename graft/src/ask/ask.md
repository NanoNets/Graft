# src/ask/ask.ts

This module provides a mechanism to process natural language queries and return structured results from a codebase, enhancing the ability to find relevant code snippets and their relationships.

- AskHit · interface · L26-L39 — Represents a hit in the query results, encapsulating details about a code symbol and its context.
- AskResult · interface · L45-L62 — Represents the result of an 'ask' query, encapsulating the query details and the hits found.
- firstProse · function · L65-L72 — Extracts the first meaningful prose line from a body of text, ignoring headings and blank lines.
- Corpus · interface · L74-L81 — Defines the structure for holding concepts and graph data used in processing queries.
- loadCorpus · function · L83-L108 — Loads a corpus of concepts and graph data from a specified directory, enabling query processing.
- score · function · L117-L128 — Calculates a score for a document based on its token counts relative to a query, enhancing relevance ranking.
- idfFromDf · function · L134-L138 — Computes the inverse document frequency (IDF) from document frequency (DF) data, aiding in scoring relevance.
- computeIdf · function · L140-L145 — Generates IDF values from document bags, which are used to weight query matches based on term rarity.
- computeIdfFromIndex · function · L154-L159 — Calculates IDF values using precomputed index data, optimizing the scoring process for queries.
- bm25 · function · L166-L182 — Implements the BM25 scoring algorithm to rank documents based on term frequency and document length.
- subjectWords · function · L194-L196 — Tokenizes a query into words while preserving qualified names, facilitating accurate subject resolution.
- findSubjectNodes · function · L206-L213 — Finds nodes in the graph that match the structural subject of a query, enhancing query resolution.
- StructuralOutcome · type · L221-L221 — Defines the possible outcomes of a structural query, indicating whether a result was found, a fallthrough note is needed, or if there was no structural intent.
- fallthroughNoteFor · function · L223-L228 — Generates a note for cases where a structural query falls back to lexical processing, providing user guidance.
- structural · function · L230-L279 — Processes a structural query to find relationships in the graph, returning relevant results or fallthrough notes.
- hasTerm · function · L298-L300 — Checks for the presence of a term in a document's token map, aiding in relevance scoring.
- matchedIdfShare · function · L309-L323 — Calculates the share of query terms matched by a document, weighted by term rarity for relevance assessment.
- lexical · function · L325-L487 — Handles lexical queries by scoring documents based on term matches and relevance, returning structured results.
- bodyLen · function · L416-L420 — Calculates the length of the body of a lexical document to ensure it meets certain criteria for processing.
- AskOptions · interface · L489-L505 — Defines the options available for configuring the ask function, allowing customization of its behavior.
- parseSpan · function · L509-L513 — Parses a string pointer into its file path and line range components, facilitating source code navigation.
- sliceSpan · function · L517-L532 — Reads a specified range of lines from a source file, allowing for inlined code snippets in query results.
- inlineSource · function · L539-L556 — Inlines the source code for the hits found, providing context directly in the results without needing to open files.
- hitFiles · function · L560-L569 — Extracts a set of unique file paths from the hits, indicating which files are relevant to the query results.
- baselineFor · function · L574-L589 — Calculates the baseline file size and character count for the hits, providing a measure of the cost of reading the full files.
- ask · function · L592-L622 — Handles the main logic for processing a query against a directory, returning structured results based on the query type.
- SkeletonEntry · interface · L626-L633 — Defines the structure of a skeleton entry, which represents a piece of information extracted from a file.
- SkeletonResult · interface · L635-L639 — Defines the structure of the result returned from the skeleton function, encapsulating the extracted information.
- skeleton · function · L644-L673 — Extracts a skeleton representation of a file, providing a summary and context for its contents.
- startLine · function · L661-L661 — Calculates the starting line number from a given span, aiding in the extraction of relevant code sections.
- formatSkeleton · function · L676-L685 — Formats the skeleton result into a string representation for display or output purposes.
- toTokens · function · L688-L690 — Converts a character count into a token count, facilitating the processing of text for queries.
- formatAsk · function · L693-L731 — Formats the results of an ask query into a string for presentation, ensuring clarity and usability.
- savingsFooter · function · L736-L748 — Generates a footer for the ask results that summarizes the savings in terms of file reading costs.
