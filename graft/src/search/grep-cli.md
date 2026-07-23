# src/search/grep-cli.ts · [[graph-traversal-and-analysis]]

This file provides the command-line interface for the grep functionality, formatting results for user-friendly output.

- GrepCliOptions · interface · L16-L23 — Defines options for the grep command-line interface, allowing customization of search behavior.
- groupHeader · function · L25-L28 — Generates a header string for a group of grep results, summarizing the group's metadata.
- formatGroup · function · L30-L34 — Formats a group of grep results into a human-readable string, including hit lines.
- formatGrepHeader · function · L37-L40 — Creates a header for the grep results, summarizing the total hits and files searched.
- truncationNote · function · L43-L50 — Generates a note about any truncation in the grep results, indicating unreadable files or additional hits beyond the cap.
- formatGrepResult · function · L54-L62 — Compiles the full human-readable report of grep results, including headers and formatted groups.
- zeroHitNote · function · L72-L77 — Provides a detailed message for zero-hit results, explaining the absence of matches and potential issues.
- runGrepCommand · function · L86-L115 — Executes the grep command, handling graph resolution, pattern searching, and output formatting.
