# src/cli.ts

Defines the command-line interface for the graft tool, enabling various operations on the codebase's context graph.

- GlobalOpts · interface · L48-L54 — Holds the global options for the CLI, allowing configuration of the context graph generation and LLM provider settings.
- cliConfig · function · L57-L66 — Constructs the configuration object for the engine based on CLI options, ensuring the correct parameters are used for graph generation.
- engineFrom · function · L68-L70 — Creates an instance of the Graft engine using the current CLI configuration, enabling graph operations.
- fmt · function · L106-L110 — Formats a record of counts into a human-readable string for console output.
- traverseAction · function · L287-L293 — Handles traversal commands for graph analysis, allowing users to query relationships between symbols in the codebase.
