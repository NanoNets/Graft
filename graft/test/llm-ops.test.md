# test/llm-ops.test.ts

Tests the behavior of three engine operations (summarize, synthesize, crux) using a fake transport to ensure they build the correct requests and handle responses appropriately.

- FakeChatModel · class · L15-L29 — Simulates a chat model to test the behavior of chat operations without network dependency.
- constructor · method · L18-L18 — Initializes the fake chat model with a predefined reply for testing purposes.
- create · method · L19-L28 — Processes a chat request and returns a simulated chat response based on predefined data.
