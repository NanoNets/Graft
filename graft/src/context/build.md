# src/context/build.ts · [[caching-mechanism]] [[context-graph-management]]

This file builds a context graph from a code repository by summarizing source files and synthesizing nodes.

- BuildProgress · interface · L47-L52 — Tracks the progress of the build process across different phases.
- BuildOptions · interface · L54-L64 — Defines options for customizing the build process, including output directory and model settings.
- BuildResult · interface · L66-L75 — Holds the results of the build process, including counts of files and nodes processed.
- BuildCache · interface · L78-L81 — Stores cached summaries and synthesized nodes to optimize the build process.
- FileWork · interface · L83-L87 — Represents the work done on each file during the build process, including its summary and hash.
- NodeDraft · interface · L90-L97 — Represents a node being constructed before finalizing its properties and links.
- buildContext · function · L99-L266 — Main function that orchestrates the building of the context graph from the source files.
- batchBySize · function · L269-L285 — Groups file summaries into batches that fit within a specified character budget for processing.
- batchKey · function · L288-L295 — Generates a stable key for a batch of file summaries based on their content hashes.
- registerName · function · L297-L300 — Registers a name and its corresponding slug in a mapping table to avoid duplicates.
- resolveSlug · function · L302-L304 — Retrieves the slug associated with a given name from a mapping table.
- errMsg · function · L306-L308 — Formats error messages for better readability.
- cachePath · function · L310-L312 — Constructs the file path for the cache storage based on the output directory.
- loadCache · function · L314-L325 — Loads the build cache from disk, returning existing summaries and synthesized nodes.
- saveCache · function · L327-L331 — Saves the current build cache to disk to persist summaries and synthesized nodes.
- mapWithConcurrency · function · L334-L349 — Executes a function over a list of items with a limit on concurrent executions, preserving order.
