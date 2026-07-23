# src/cli.ts

Defines the command-line interface for the graft tool, enabling various operations on the codebase's context graph.

- GlobalOpts · interface · L46-L52 — Holds the global options for the CLI, allowing configuration of the context graph generation and LLM provider settings.
- cliConfig · function · L55-L64 — Constructs the configuration object for the engine based on CLI options, ensuring the correct parameters are used for graph generation.
- engineFrom · function · L66-L66 — Creates an instance of the Graft engine using the current CLI configuration, enabling graph operations.
- fmt · function · L101-L105 — Formats a record of counts into a human-readable string for console output.
