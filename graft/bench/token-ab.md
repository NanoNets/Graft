# bench/token-ab.ts · [[benchmarking-system]] [[token-a-b-testing]]

This script benchmarks the performance of an agent using two different approaches (COLD and GRAFT) to determine if providing pre-computed context saves tokens during code exploration.

- Metrics · interface · L55-L64 — Defines the structure for capturing metrics related to the A/B testing of the agent's performance.
- runSearch · function · L98-L128 — Executes a regex search across the repository to find relevant code snippets based on a given pattern.
- runRead · function · L130-L147 — Reads a specified source file or a range of lines from it, ensuring it is within the repository's bounds.
- runAgent · function · L150-L207 — Manages the agent's execution loop, handling user queries and tool calls while tracking performance metrics.
- graftPack · function · L210-L221 — Generates a context pack using the graft tool to provide pre-computed information for the agent.
- cost · function · L223-L227 — Calculates the estimated cost of the agent's operations based on token usage and pricing configuration.
- row · function · L229-L231 — Formats a row of metrics for display in the output table comparing the COLD and GRAFT arms.
- main · function · L233-L273 — Coordinates the overall execution of the A/B test, including generating the graft pack and running both agent arms.
- pct · function · L253-L253 — Calculates the percentage improvement in token usage between the COLD and GRAFT arms.
