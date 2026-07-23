# src/claude/hooks.ts

Handles various events related to the Graft system, including session management and user prompts.

- readStdin · function · L14-L18 — Reads input from standard input, handling test seams and parsing JSON.
- safeReadFd0 · function · L19-L19 — Safely reads from the standard input file descriptor, returning an empty string on failure.
- projectDir · function · L21-L23 — Determines the project directory based on environment variables or input parameters.
- underGraft · function · L24-L27 — Checks if a given file is part of the graft project structure.
- graftJson · function · L28-L41 — Executes a command to retrieve JSON output from the graft CLI, handling errors gracefully.
- checkStaleCount · function · L42-L46 — Counts the number of changes in the graft graph to determine if it is stale.
- emit · function · L47-L49 — Outputs a JSON object to standard output for event tracking.
- handlePostEdit · function · L51-L57 — Handles post-edit events by updating stats and emitting relevant information.
- handleStop · function · L59-L73 — Handles the stop event by syncing state if necessary.
- main · function · L75-L113 — Main entry point for handling various events and orchestrating the application logic.
