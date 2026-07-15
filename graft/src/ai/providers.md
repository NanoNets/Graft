# src/ai/providers.ts · [[configuration-management]]

This file defines configurations for an AI engine, allowing customization and default settings for its operation.

- EngineConfig · interface · L9-L25 — EngineConfig provides a structure for user-defined settings, enabling flexibility in configuring the AI engine's behavior.
- ResolvedConfig · interface · L28-L35 — ResolvedConfig represents the final configuration after merging user inputs with defaults and environment variables, ensuring all necessary settings are available.
- resolveConfig · function · L43-L55 — resolveConfig combines user configuration with environment variables and defaults to produce a complete configuration for the AI engine.
