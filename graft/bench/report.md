# bench/report.ts · [[benchmarking-system]] [[report]]

This file aggregates and reports benchmark results for different agent configurations, providing insights into performance metrics.

- Arm · type · L6-L6 — Defines the possible execution arms for the benchmarking process, categorizing the types of agent runs.
- Row · interface · L8-L30 — Represents a single trial's data, encapsulating all relevant metrics for benchmarking an agent's performance.
- costOf · function · L37-L42 — Calculates the approximate cost of running an agent based on input and output tokens and cache operations.
- mean · function · L44-L46 — Computes the mean of an array of numbers, returning zero for an empty array.
- ArmAgg · interface · L48-L58 — Represents aggregated metrics for a specific arm of the benchmark, including totals and averages.
- aggregate · function · L60-L72 — Aggregates multiple benchmark rows into a single ArmAgg object, calculating averages for various metrics.
- pctDelta · function · L74-L78 — Calculates the percentage delta between two values, handling the case where the first value is zero.
- fmt · function · L80-L82 — Formats a number for display, adjusting for thousands and decimal precision.
- metricTable · function · L88-L114 — Generates a formatted metric table comparing performance across different agent arms, highlighting key metrics and deltas.
- cells · function · L93-L102 — Constructs individual cells for the metric table, calculating values and formatting them for display.
- verdictFor · function · L117-L127 — Evaluates and compares the cost and correctness of two agent configurations, providing a verdict on their performance.
- buildMarkdown · function · L129-L175 — Compiles the overall benchmark results into a markdown format for easy readability and presentation.
