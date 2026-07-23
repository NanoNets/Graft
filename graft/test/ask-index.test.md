# test/ask-index.test.ts · [[testing-and-validation]]

This file contains tests to ensure the integrity and correctness of the `ask` sidecar functionality, verifying that it accurately reproduces live tokenization results and handles various edge cases without failure.

- makeFixture · function · L26-L50 — Creates a temporary multi-file fixture with overlapping vocabulary to facilitate meaningful tests on tokenization and scoring.
- reinjectBodyText · function · L69-L85 — Reconstructs the body text for nodes in the wiring.json to ensure accurate tokenization results during tests.
- sortPairs · function · L106-L106 — Sorts an array of pairs by the first element, ensuring consistent ordering for comparison in tests.
