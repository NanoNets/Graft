# bench/selfcheck.ts · [[benchmarking-framework]] [[error-handling-and-robustness]] [[self-check-mechanism]]

This file performs an offline verification of the harness plumbing to ensure control flow works correctly without needing an API key.

- makeStubClient · function · L19-L48 — Creates a stub client that simulates responses for agent and judge interactions during testing.
- main · function · L50-L114 — Coordinates the self-check process by setting up a temporary environment, running the agent, and validating the results.
