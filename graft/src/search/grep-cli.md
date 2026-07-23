# src/search/grep-cli.ts · [[graph-traversal-and-analysis]]

This file provides the command-line interface for the grep functionality, formatting results for user-friendly output.

- GrepCliOptions · interface · L15-L22 — Defines options for the grep command-line interface, allowing customization of search behavior.
- groupHeader · function · L24-L27 — Generates a header string for a group of grep results, summarizing the group's metadata.
- formatGroup · function · L29-L33 — Formats a group of grep results into a human-readable string, including hit lines.
- formatGrepHeader · function · L36-L39 — Creates a header for the grep results, summarizing the total hits and files searched.
- truncationNote · function · L42-L49 — Generates a note about any truncation in the grep results, indicating unreadable files or additional hits beyond the cap.
- formatGrepResult · function · L53-L59 — Compiles the full human-readable report of grep results, including headers and formatted groups.
- zeroHitNote · function · L69-L74 — Provides a detailed message for zero-hit results, explaining the absence of matches and potential issues.
- runGrepCommand · function · L83-L112 — Executes the grep command, handling graph resolution, pattern searching, and output formatting.
