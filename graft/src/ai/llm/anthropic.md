# src/ai/llm/anthropic.ts

This module provides an adapter for the Anthropic Messages API, enabling seamless integration of Claude as a first-class AI provider while handling specific API differences.

- AnthropicChatModelOptions · interface · L24-L31 — Defines the configuration options required to instantiate an Anthropic chat model, ensuring necessary parameters are provided.
- CacheControl · type · L33-L33 — Specifies the cache control settings for ephemeral data management in the chat model.
- cc · function · L34-L34 — Creates a cache control object based on a boolean flag to manage ephemeral caching behavior.
- AnthropicChatModel · class · L36-L141 — Implements the chat model interface for interacting with the Anthropic API, encapsulating the logic for message handling and API communication.
- constructor · method · L41-L45 — Initializes an instance of the AnthropicChatModel with the provided options, setting up the necessary API client and model details.
- create · method · L47-L100 — Handles the creation of chat messages by processing input requests and formatting them for the Anthropic API, ensuring compliance with API requirements.
- assistantParam · method · L103-L111 — Reconstructs the assistant's response from the original message blocks, preserving the context and structure of the conversation.
- fromResponse · method · L113-L140 — Transforms the API response into a structured ChatResponse object, extracting relevant information and maintaining the original message format.
- toAnthropicTool · function · L143-L145 — Converts a ToolSpec into the format required by the Anthropic API, facilitating the integration of tools into chat requests.
- normalizeUsage · function · L148-L155 — Normalizes the usage statistics from the Anthropic API response, providing a consistent structure for input and output token counts.
