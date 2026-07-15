# src/graph/enrich.ts · [[caching-mechanism]] [[context-graph-management]]

This file implements a mechanism to enrich graph nodes with summaries and cruxes based on their state and prior computations.

- EnrichOptions · interface · L28-L33 — Defines options for enriching graph nodes, including the ability to compute new summaries and report progress.
- EnrichStats · interface · L35-L41 — Tracks the statistics of the enrichment process, including counts of cached, computed, stale, and pending nodes.
- enrichGraph · function · L43-L128 — Enriches a set of graph nodes by determining which need new summaries and processing them accordingly.
- collectFileCrux · function · L135-L155 — Collects crux information for nodes in a file, handling potential errors and ensuring partial results are returned.
- buildCrux · function · L162-L177 — Extracts and formats the crux text from a source file based on the model's provided line range.
- spanLines · function · L180-L186 — Parses a line span string into a clamped range of line numbers, ensuring valid boundaries.
