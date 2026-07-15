# bench/report.ts · [[benchmarking-framework]] [[benchmarking-results-reporting]] [[caching-mechanism]]

This file provides functionality for aggregating and reporting benchmark results for different agent configurations.

- Row · interface · L6-L26 — Defines the structure of a benchmark trial row, capturing various metrics related to agent performance.
- costOf · function · L33-L38 — Calculates the approximate cost of running an agent based on input and output tokens and cache operations.
- mean · function · L40-L42 — Computes the mean of an array of numbers, returning zero for an empty array.
- ArmAgg · interface · L44-L54 — Represents aggregated metrics for a specific arm of the benchmark, including totals and averages.
- aggregate · function · L56-L68 — Aggregates multiple benchmark rows into a single ArmAgg object, calculating averages for various metrics.
- pctDelta · function · L70-L74 — Calculates the percentage delta between two values, handling the case where the first value is zero.
- fmt · function · L76-L78 — Formats a number for display, adjusting for thousands and decimal precision.
- buildMarkdown · function · L80-L125 — Generates a markdown report summarizing benchmark results across different corpora and arms.
