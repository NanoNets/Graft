# test/ask.test.ts · [[testing-and-validation]]

Contains tests for the `ask` functionality, validating its behavior with various options and scenarios.

- makeFixture · function · L17-L26 — Creates a temporary directory with a sample TypeScript file for testing purposes.
- stampCrux · function · L44-L50 — Updates the wiring.json file to include a crux for the specified node, allowing for inlined source retrieval.
- qualifiedFixture · function · L190-L208 — Sets up a temporary directory with a cache implementation to test structural resolution of function calls.
- multiScopeFixture · function · L277-L310 — function multiScopeFixture(): string
- siblingPrefixFixture · function · L336-L343 — function siblingPrefixFixture(): string
- idfShiftFixture · function · L370-L381 — function idfShiftFixture(): string
- rankOf · function · L388-L388 — rankOf = (r: ReturnType<typeof ask>["hits"], title: string)
- duplicateNameFixture · function · L555-L570 — function duplicateNameFixture(): string
