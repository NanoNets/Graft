# src/claude/hooks.ts

Handles various events related to the Graft system, including session management and user prompts.

- readStdin · function · L15-L19 — Reads input from standard input, handling test seams and parsing JSON.
- safeReadFd0 · function · L20-L20 — Safely reads from the standard input file descriptor, returning an empty string on failure.
- projectDir · function · L22-L24 — Determines the project directory based on environment variables or input parameters.
- underGraft · function · L25-L28 — Checks if a given file is part of the graft project structure.
- graftJson · function · L29-L47 — Executes a command to retrieve JSON output from the graft CLI, handling errors gracefully.
- checkStaleCount · function · L48-L52 — Counts the number of changes in the graft graph to determine if it is stale.
- emit · function · L53-L55 — Outputs a JSON object to standard output for event tracking.
- handlePostEdit · function · L57-L63 — Handles post-edit events by updating stats and emitting relevant information.
- lastFileScopeHint · function · L80-L105 — function lastFileScopeHint(dir: string, lastFile: string | null | undefined): string | null
- handleStop · function · L107-L121 — Handles the stop event by syncing state if necessary.
- main · function · L123-L166 — Main entry point for handling various events and orchestrating the application logic.
