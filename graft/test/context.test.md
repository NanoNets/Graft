# test/context.test.ts · [[testing-and-validation]]

This file contains end-to-end tests for the markdown-graph pipeline, ensuring that the initialization and checking processes work correctly with various scenarios.

- runCli · function · L19-L30 — This function executes a command-line interface (CLI) command and captures its output, allowing tests to verify the behavior of the CLI under different conditions.
- makeFixture · function · L32-L43 — This function creates a temporary directory with mock service files for testing the context building process.
- buildOpts · function · L45-L47 — This function generates options for building the context, including a fake model and providers.
