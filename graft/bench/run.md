# bench/run.ts · [[benchmarking-system]] [[error-handling-and-reporting]]

Orchestrates benchmarking tasks across different configurations and trials, ensuring efficient execution and result collection.

- Args · interface · L39-L45 — Defines the structure for command-line arguments to configure the benchmarking process.
- parseArgs · function · L47-L67 — Parses command-line arguments to set up the benchmarking configuration, ensuring valid options are provided.
- pool · function · L70-L81 — Executes a function on a set of items concurrently, limiting the number of simultaneous operations.
- worker · function · L73-L78 — Processes items in the pool function, handling each item asynchronously.
- main · function · L83-L204 — Coordinates the overall benchmarking process, including argument parsing, corpus handling, and result generation.
