# src/ask/ask.ts

This module provides a mechanism to process natural language queries and return structured results from a codebase, enhancing the ability to find relevant code snippets and their relationships.

- AskHit · interface · L29-L46 — Represents a hit in the query results, encapsulating details about a code symbol and its context.
- AskResult · interface · L52-L74 — Represents the result of an 'ask' query, encapsulating the query details and the hits found.
- firstProse · function · L77-L84 — Extracts the first meaningful prose line from a body of text, ignoring headings and blank lines.
- Corpus · interface · L86-L93 — Defines the structure for holding concepts and graph data used in processing queries.
- loadCorpus · function · L95-L120 — Loads a corpus of concepts and graph data from a specified directory, enabling query processing.
- score · function · L129-L140 — Calculates a score for a document based on its token counts relative to a query, enhancing relevance ranking.
- idfFromDf · function · L146-L150 — Computes the inverse document frequency (IDF) from document frequency (DF) data, aiding in scoring relevance.
- computeIdf · function · L152-L157 — Generates IDF values from document bags, which are used to weight query matches based on term rarity.
- computeIdfFromIndex · function · L166-L171 — Calculates IDF values using precomputed index data, optimizing the scoring process for queries.
- bm25 · function · L178-L194 — Implements the BM25 scoring algorithm to rank documents based on term frequency and document length.
- subjectWords · function · L206-L208 — Tokenizes a query into words while preserving qualified names, facilitating accurate subject resolution.
- findSubjectNodes · function · L227-L235 — Finds nodes in the graph that match the structural subject of a query, enhancing query resolution.
- StructuralOutcome · type · L243-L243 — Defines the possible outcomes of a structural query, indicating whether a result was found, a fallthrough note is needed, or if there was no structural intent.
- fallthroughNoteFor · function · L245-L250 — Generates a note for cases where a structural query falls back to lexical processing, providing user guidance.
- structural · function · L252-L301 — Processes a structural query to find relationships in the graph, returning relevant results or fallthrough notes.
- hasTerm · function · L320-L322 — Checks for the presence of a term in a document's token map, aiding in relevance scoring.
- matchedIdfShare · function · L331-L345 — Calculates the share of query terms matched by a document, weighted by term rarity for relevance assessment.
- lexical · function · L347-L627 — Handles lexical queries by scoring documents based on term matches and relevance, returning structured results.
- bodyLen · function · L463-L467 — Calculates the length of the body of a lexical document to ensure it meets certain criteria for processing.
- AskOptions · interface · L629-L651 — Defines the options available for configuring the ask function, allowing customization of its behavior.
- parseSpan · function · L655-L659 — Parses a string pointer into its file path and line range components, facilitating source code navigation.
- sliceSpan · function · L663-L678 — Reads a specified range of lines from a source file, allowing for inlined code snippets in query results.
- inlineSource · function · L685-L702 — Inlines the source code for the hits found, providing context directly in the results without needing to open files.
- hitFiles · function · L706-L715 — Extracts a set of unique file paths from the hits, indicating which files are relevant to the query results.
- baselineFor · function · L720-L723 — Calculates the baseline file size and character count for the hits, providing a measure of the cost of reading the full files.
- ask · function · L726-L771 — Handles the main logic for processing a query against a directory, returning structured results based on the query type.
- SkeletonEntry · interface · L775-L782 — Defines the structure of a skeleton entry, which represents a piece of information extracted from a file.
- SkeletonResult · interface · L784-L790 — Defines the structure of the result returned from the skeleton function, encapsulating the extracted information.
- skeleton · function · L795-L825 — Extracts a skeleton representation of a file, providing a summary and context for its contents.
- startLine · function · L812-L812 — Calculates the starting line number from a given span, aiding in the extraction of relevant code sections.
- formatSkeleton · function · L828-L838 — Formats the skeleton result into a string representation for display or output purposes.
- toTokens · function · L841-L843 — Converts a character count into a token count, facilitating the processing of text for queries.
- formatAsk · function · L846-L888 — Formats the results of an ask query into a string for presentation, ensuring clarity and usability.
- escalationNudge · function · L895-L902 — function escalationNudge(r: AskResult): string
- askSavingsFooter · function · L907-L919 — function askSavingsFooter(r: AskResult, body: string): string
- scopeFooterLines · function · L926-L938 — function scopeFooterLines(r: AskResult): string[]
