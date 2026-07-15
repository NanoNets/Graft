# bench/agent.ts · [[benchmarking-framework]] [[caching-mechanism]]

This file implements a benchmark agent that processes questions about a codebase using filesystem tools and a language model.

- AgentResult · interface · L19-L27 — Defines the structure of the result returned by the agent, encapsulating the answer and various metrics.
- RunAgentOptions · interface · L29-L37 — Specifies the options for running the agent, including the root directory and the question to be answered.
- safePath · function · L46-L60 — Ensures that a given path is safely resolved within a specified root directory, preventing directory traversal attacks.
- listFiles · function · L62-L89 — Recursively lists all files in a directory while respecting size limits and skipping specified directories.
- walk · function · L64-L86 — A helper function that traverses a directory to collect file paths, avoiding hidden files and skipped directories.
- globToRegExp · function · L92-L106 — Converts a glob pattern into a regular expression for matching file paths.
- runTool · function · L168-L228 — Executes a specified tool (like reading a file or listing a directory) based on the provided input parameters.
- runAgent · function · L230-L322 — Manages the execution of the agent's logic, including handling user questions and tool interactions.
- slideCacheBreakpoint · function · L254-L260 — Maintains the cache state by updating the cache control for the most recent tool result in the message history.
