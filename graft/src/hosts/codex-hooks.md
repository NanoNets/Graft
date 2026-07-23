# src/hosts/codex-hooks.ts · [[host-management-and-configuration]]

Facilitates the installation and management of user-level hooks for CLI agents, ensuring that hooks are correctly written and updated in the hooks.json configuration file after file edits.

- HookWrite · interface · L11-L15 — Defines the structure for hook write operations, encapsulating the ID, path, and action taken during the write process.
- dirExists · function · L17-L19 — Checks if a given directory path exists, returning a boolean value to indicate its existence.
- writeOwned · function · L21-L31 — Handles the creation or updating of a file with specific content and permissions, returning the action taken.
- isGraftEntry · function · L33-L35 — Determines if a given entry is a graft entry by checking for a specific string in its JSON representation.
- installCodexHooks · function · L37-L74 — Installs codex hooks by writing a shim and updating the hooks configuration based on the provided home directory.
