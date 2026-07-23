# src/ask/index-file.ts

This file provides functionality for building and reading a cache of tokenized graph data to optimize query performance.

- tokenize · function · L38-L44 — Tokenizes input text into lowercased subword tokens, ensuring consistent tokenization for both build-time and query-time processes.
- counts · function · L47-L51 — Counts the frequency of each token in a given array, facilitating the creation of term-frequency maps for documents.
- AskIndexDoc · interface · L54-L59 — Defines the structure for storing token bags associated with a single document in the index.
- AskIndex · interface · L63-L69 — Represents the overall structure of the ask index, including document frequencies and average body length for efficient querying.
- askIndexPath · function · L76-L78 — Generates the absolute file path for the ask index sidecar based on the output directory.
- pairs · function · L80-L82 — Converts a Map of token counts into a sorted array format suitable for JSON serialization.
- bagLen · function · L85-L89 — Calculates the total count of tokens in a document's field, representing its length.
- writeAskIndex · function · L98-L131 — Writes the tokenized representation of graph nodes and their frequencies to a JSON file, creating a cache for future queries.
- readAskIndex · function · L138-L159 — Reads and validates the ask index from a file, ensuring data integrity before use in queries.
