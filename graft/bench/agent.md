# bench/agent.ts · [[agent]] [[benchmarking-system]]

This file implements a benchmark agent that executes a loop for evaluating the performance of different AI models in answering questions based on a codebase.

- AgentResult · interface · L20-L28 — Defines the structure of the result returned by the agent, encapsulating the answer and various metrics.
- RunAgentOptions · interface · L30-L42 — Defines the options for running the agent, including the root directory and the question to be answered.
- safePath · function · L51-L65 — Ensures that a given path is safely resolved within a specified root directory, preventing directory traversal attacks.
- listFiles · function · L67-L94 — Recursively lists all files in a directory while respecting size limits and skipping specified directories.
- walk · function · L69-L91 — A helper function that traverses a directory to collect file paths, avoiding hidden files and skipped directories.
- globToRegExp · function · L97-L111 — Converts a glob pattern into a regular expression for matching file paths.
- runTool · function · L189-L259 — Executes a specified tool with given input, handling various file operations and queries within a defined root directory.
- runAgent · function · L261-L341 — Manages the execution of the agent, processing user questions and utilizing tools to generate answers while tracking performance metrics.
- slideCacheBreakpoint · function · L289-L294 — Maintains the cache breakpoint on the most recent tool result to optimize performance during the agent's execution.
