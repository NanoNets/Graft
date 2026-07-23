# src/claude/format.ts

This file contains functions and types for formatting and rendering status information related to a graph-based system.

- enrichedSegment · function · L13-L17 — Calculates the percentage of enriched items based on the ready count and total count, returning a formatted string if there are any enriched items.
- freshnessSegment · function · L19-L24 — Generates a status message indicating the freshness of the data, highlighting if the data is syncing or stale.
- renderStatusline · function · L26-L48 — Constructs a status line for displaying the current state of the system, including node and edge counts, enrichment status, and session information.
- nodeIdsInFile · function · L50-L56 — Retrieves a set of node IDs from a graph that correspond to a specified file path, filtering based on path matches.
- incomingEdges · function · L58-L62 — Finds all incoming edges for nodes in a graph that correspond to a specified file path, returning those edges that target the nodes.
- formatBlastRadius · function · L64-L75 — Formats a string that describes the blast radius for a given file, listing dependencies and their relationships, up to a specified cap.
- AskJson · interface · L77-L84 — Defines the structure for a JSON object used in retrieval queries, encapsulating query details and hit information.
- tokensOf · function · L86-L86 — Calculates the number of tokens based on character count, facilitating token management in retrieval processes.
- retrievalBody · function · L91-L108 — Constructs a formatted string representation of retrieval hits, including pointers and snippets, for display purposes.
- retrievalTokensSaved · function · L111-L117 — Calculates the number of tokens saved by using a retrieval pack instead of reading files in full, based on the hits and baseline size.
- formatRetrieval · function · L119-L132 — Formats the retrieval results into a string, including details about tokens saved and the estimated size of the retrieval pack.
- relevantRetrieval · function · L152-L163 — Determines if a retrieval pack should be injected based on relevance and novelty, returning the formatted text or null if not applicable.
- formatOrientation · function · L165-L176 — Creates a formatted string representing the orientation of the repository map, limited to a specified byte budget.
- renderSubagent · function · L178-L182 — Generates a string representation of a subagent's status, including its query if available, for display purposes.
