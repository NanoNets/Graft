# src/ask/ask.ts

This file implements a query tool that routes natural language queries to relevant code symbols and returns structured context information.

- AskHit · interface · L26-L39 — Represents a hit in the query results, encapsulating details about a code symbol and its context.
- AskResult · interface · L45-L56 — Encapsulates the result of a query, including the query string, mode of operation, and the hits found.
- firstProse · function · L59-L66 — Extracts the first meaningful prose line from a body of text, ignoring headings and blank lines.
- Corpus · interface · L68-L75 — Defines the structure for a corpus containing concepts and a graph, used for processing queries.
- loadCorpus · function · L77-L102 — Loads a corpus from a specified directory, extracting concepts and building a graph for query processing.
- score · function · L111-L122 — Calculates a score for a document's token counts against a query, facilitating relevance ranking.
- idfFromDf · function · L128-L132 — function idfFromDf(df: Map<string, number>, n: number): Map<string, number>
- computeIdf · function · L134-L139 — function computeIdf(docBags: Array<Set<string>>): Map<string, number>
- computeIdfFromIndex · function · L148-L153 — function computeIdfFromIndex(index: AskIndex, conceptBags: Array<Set<string>>): Map<string, number>
- bm25 · function · L160-L176 — function bm25( query: Map<string, number>, doc: Map<string, number>, idf: Map<string, number>, dl: number, avgdl: number, ): number
- subjectWords · function · L188-L190 — function subjectWords(query: string): string[]
- findSubjectNodes · function · L200-L207 — function findSubjectNodes(query: string, graph: GraphV1): { nodes: NodeV1[]; tried: string }
- StructuralOutcome · type · L215-L215 — type StructuralOutcome = { result: AskResult } | { fallthroughNote: string } | null;
- fallthroughNoteFor · function · L217-L222 — function fallthroughNoteFor(subject: string): string
- structural · function · L224-L273 — Processes a structural query to find and return relevant callers or callees from the graph based on the query.
- lexical · function · L290-L435 — Ranks concepts and symbols based on lexical matching with the query, returning the most relevant results.
- bodyLen · function · L369-L373 — bodyLen = (m: Map<string, number>)
- AskOptions · interface · L437-L447 — Defines options for customizing the behavior of the ask function, such as context directory and result limits.
- parseSpan · function · L451-L455 — Parses a string pointer into its file path and line range components, facilitating source code navigation.
- sliceSpan · function · L459-L474 — Reads a specified range of lines from a source file, allowing for inlined code snippets in query results.
- inlineSource · function · L477-L484 — Attaches inlined source code to query hits, enhancing the context provided to the user.
- hitFiles · function · L488-L497 — function hitFiles(hits: AskHit[]): Set<string>
- baselineFor · function · L502-L517 — function baselineFor(hits: AskHit[], graph: GraphV1 | null): AskResult["saved"] | undefined
- ask · function · L520-L550 — Processes a query against a code graph, returning structured results based on the query type and context.
- toTokens · function · L553-L555 — function toTokens(chars: number): number
- formatAsk · function · L558-L596 — Formats the results of a query into a markdown context pack for easy readability and presentation.
- savingsFooter · function · L601-L613 — function savingsFooter(r: AskResult, body: string): string
