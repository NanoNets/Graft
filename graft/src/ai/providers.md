# src/ai/providers.ts · [[configuration-management]]

This module provides configuration management for AI model providers, allowing users to specify settings and defaults for various AI services.

- EngineConfig · interface · L17-L39 — Defines the configuration structure for the engine, allowing customization of various parameters for LLM operations.
- ResolvedConfig · interface · L42-L55 — Represents the fully resolved configuration after merging user settings with defaults and environment variables.
- resolveConfig · function · L71-L106 — Merges user-provided configuration with environment variables and defaults to produce a complete configuration object.
