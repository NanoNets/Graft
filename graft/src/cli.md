# src/cli.ts

This file implements the `graft` CLI tool for building and maintaining a context graph from code, ensuring it stays in sync with the repository.

- engineFrom · function · L43-L46 — Creates an instance of the Graft engine configured with the specified context directory.
- fmt · function · L82-L86 — Formats a record of counts into a human-readable string for console output.
- traverseAction · function · L242-L248 — function traverseAction(kind: import("./graph/traverse-cli.js").TraverseKind)
