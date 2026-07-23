# test/mcp-tools.test.ts · [[mcp-server-and-tools]]

This test suite validates the functionality of various tools in the MCP codebase, ensuring they operate correctly on built repositories and handle errors appropriately.

- builtRepo · function · L9-L16 — Creates a temporary repository structure for testing the tools with a basic math implementation.
- chainRepo · function · L22-L33 — Sets up a repository with a three-deep function call structure to test depth-related functionality in tools.
- customDirRepo · function · L37-L45 — Establishes a repository in a custom directory to validate the handling of non-default graph locations.
- fileScopeRepo · function · L50-L60 — Creates a repository to test the interaction between file imports and function calls across files.
- multiDirRepo · function · L65-L73 — Generates a repository with multiple directories to test the handling of directory limits in tool operations.
