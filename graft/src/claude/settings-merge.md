# src/claude/settings-merge.ts · [[configuration-management]]

Merges existing settings with new graft configurations, ensuring proper command hooks and permissions are set while avoiding conflicts.

- Json · type · L1-L1 — Defines a flexible JSON type for various settings configurations.
- hookCmd · function · L7-L9 — Generates a command string to execute a specified hook in the Graft environment.
- graftBlocks · function · L10-L17 — Creates a mapping of events to their corresponding Graft command hooks for processing user actions.
- isGraftHookEntry · function · L18-L20 — Checks if a given entry is a Graft hook by inspecting its command reference.
- mergeGraftSettings · function · L22-L55 — Merges existing settings with Graft-specific configurations, ensuring idempotency and compliance with Graft rules.
