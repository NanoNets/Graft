# test/ask.test.ts · [[testing-and-validation]]

Contains tests for the `ask` functionality, validating its behavior with various options and scenarios.

- makeFixture · function · L16-L25 — Creates a temporary directory with a sample TypeScript file for testing purposes.
- stampCrux · function · L43-L49 — Updates the wiring.json file to include a crux for the specified node, allowing for inlined source retrieval.
- qualifiedFixture · function · L189-L207 — Sets up a temporary directory with a cache implementation to test structural resolution of function calls.
