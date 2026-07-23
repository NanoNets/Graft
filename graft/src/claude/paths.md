# src/claude/paths.ts

This module provides utility functions to resolve paths for the graft CLI and related scripts, ensuring correct path resolution regardless of the installation context.

- graftCliPath · function · L11-L13 — Provides the absolute path to the graft CLI, ensuring it can be located regardless of the installation context.
- claudeDistDir · function · L18-L20 — Returns the absolute path to the package's distribution directory, facilitating consistent access to resources without guesswork.
- claudeScriptPath · function · L23-L25 — Constructs the absolute path to a sibling script in the claude directory, enabling dynamic script resolution.
