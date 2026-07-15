# bench/run.ts · [[benchmarking-framework]] [[error-handling-and-robustness]]

This file orchestrates the benchmarking process for various corpora and tasks, managing the execution and reporting of results.

- Args · interface · L29-L35 — Defines the structure for command-line arguments used to configure the benchmarking run.
- parseArgs · function · L37-L52 — Parses command-line arguments to extract configuration options for the benchmarking process.
- pool · function · L55-L66 — Executes a function on a set of items concurrently, limiting the number of simultaneous operations.
- worker · function · L58-L63 — Processes items in the pool function, handling each item asynchronously.
- makeDocsWorkdir · function · L69-L82 — Creates a temporary working directory for processing documents in a specified corpus.
- main · function · L84-L201 — Coordinates the overall benchmarking process, including argument parsing, corpus ingestion, and result reporting.
