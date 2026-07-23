# bench/selfcheck.ts · [[benchmarking-system]] [[self-check-mechanism]]

This file provides an offline verification mechanism for the harness plumbing, ensuring control flow integrity without requiring an API key.

- makeStubModel · function · L20-L39 — Creates a stubbed ChatModel that simulates agent behavior for testing purposes, allowing for controlled responses during the agent loop.
- create · method · L24-L37 — Handles requests by returning predefined responses based on the request format, simulating the agent's decision-making process.
- main · function · L41-L105 — Coordinates the self-check process by setting up the environment, running the agent, and validating the results through assertions.
