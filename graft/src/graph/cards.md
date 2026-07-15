# src/graph/cards.ts

This module generates markdown cards that summarize source files and their symbols for easier navigation and understanding of the codebase.

- CardFileInfo · interface · L26-L32 — Holds information about a card's path, the source file it mirrors, and the number of symbols it contains.
- CardStats · interface · L34-L38 — Tracks the statistics of card generation, including how many cards were written and pruned.
- cardPathFor · function · L41-L44 — Constructs the markdown file path for a card by replacing the source file's extension with .md.
- spanStart · function · L47-L50 — Extracts the starting line number from a given span string, returning 0 if the format is unparseable.
- oneLiner · function · L53-L57 — Retrieves a concise summary or signature of a node, prioritizing the summary if available.
- conceptsByPath · function · L60-L70 — Maps source paths to their corresponding concept node slugs, facilitating the creation of up-links in cards.
- renderCard · function · L73-L99 — Generates the markdown content for a card, including the source file's summary and its symbols.
- listExistingCards · function · L102-L121 — Lists all existing markdown card files in the output directory, excluding concept nodes and specific top-level files.
- walk · function · L104-L113 — Recursively traverses directories to find markdown files for existing cards.
- pruneEmptyDirs · function · L124-L144 — Removes empty directories from the output directory, ensuring a clean structure after card generation.
- visit · function · L125-L142 — Visits directories to determine if they are empty after processing their contents.
- writeCards · function · L150-L183 — Writes markdown cards for each source file, reflecting the source tree and pruning any outdated cards.
- writeIndex · function · L189-L224 — Creates an index markdown file that lists all concept nodes and per-file cards for easy navigation.
- CoverRef · interface · L227-L232 — Represents a symbol covered by a concept node, including its name, kind, and location.
- writeCovers · function · L247-L283 — Backfills concept nodes with a list of symbols they cover, enhancing their metadata for better navigation.
