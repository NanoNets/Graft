# src/hosts/mcp-config.ts · [[host-management-and-configuration]]

Facilitates the registration and configuration of multiple MCP servers in specified host configurations, ensuring proper JSON and TOML formatting.

- McpWrite · interface · L10-L14 — Defines the structure for writing MCP configuration results, indicating the operation performed on the configuration file.
- dirExists · function · L19-L21 — Checks if a given directory path exists, returning a boolean value.
- mergeJsonKey · function · L23-L43 — Merges a JSON entry into a specified key of a JSON file, creating or updating the file as necessary.
- upsertCodexToml · function · L45-L54 — Inserts or updates a section in a TOML configuration file for the codex, ensuring the section exists.
- registerMcpConfigs · function · L56-L87 — Registers MCP configurations for multiple IDs, handling different file types and structures based on the ID.
