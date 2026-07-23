# src/ai/llm/openai.ts

This module provides an adapter for interacting with various OpenAI-compatible endpoints, allowing users to send chat requests and receive responses while managing caching and formatting options.

- OpenAIChatModelOptions · interface · L19-L29 — Defines the configuration options for the OpenAI chat model, including API key and model type.
- ChatParams · type · L31-L31 — Defines the parameters required for creating a chat completion request, ensuring the correct structure is used for API calls.
- ChatMessage · type · L32-L32 — Represents a message in the chat, encapsulating the role and content to facilitate communication between users and the AI.
- textPart · function · L35-L39 — Constructs a text message part with optional cache control for OpenRouter passthrough.
- toChatMessage · function · L41-L67 — Transforms a message object into a format suitable for OpenAI's chat API, handling different roles appropriately.
- toChatTool · function · L69-L71 — Converts a tool specification into a format compatible with OpenAI's chat completion API, enabling the use of external tools in chat interactions.
- OpenAIChatModel · class · L73-L162 — Implements the chat model interface for interacting with OpenAI's chat completions API.
- constructor · method · L78-L88 — Initializes an OpenAIChatModel instance with the specified options, setting up the necessary API client and model parameters for chat interactions.
- create · method · L90-L115 — Creates a chat completion request to the OpenAI API using the provided messages and parameters.
- fromResponse · method · L117-L161 — Processes the response from the OpenAI API to extract relevant chat information and tool calls.
- parse · function · L127-L133 — Safely parses a JSON string into an object, handling errors to ensure robust processing of responses from the chat API.
- normalizeUsage · function · L165-L174 — Normalizes usage statistics by calculating uncached input tokens from the OpenAI API response.
