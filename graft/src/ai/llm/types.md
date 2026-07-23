# src/ai/llm/types.ts

Defines interfaces and types for a provider-neutral chat transport system that facilitates communication with various language model providers.

- ToolCall · interface · L23-L28 — Represents a single invocation of a tool requested by the model, encapsulating its ID, name, and parsed arguments.
- Message · interface · L31-L52 — Defines a turn in a conversation, allowing for structured communication between users and the assistant, including tool calls and raw provider data.
- ToolSpec · interface · L55-L59 — Describes a tool that the model can call, including its name, description, and parameters, facilitating interaction with various tools.
- ResponseFormat · type · L68-L71 — Specifies the format in which the model must respond, ensuring compatibility across different output types like text, JSON, or tool calls.
- Usage · interface · L78-L83 — Tracks token usage across providers, normalizing input and output counts to facilitate consistent accounting in multi-provider environments.
- ChatRequest · interface · L85-L94 — Encapsulates a request to the chat model, including messages, tools, and response format, to standardize interactions with the model.
- ChatResponse · interface · L96-L104 — Represents the response from the chat model, including the assistant's text, tool calls made, and usage statistics, to provide a complete interaction result.
- ChatModel · interface · L110-L113 — Defines a connection to a specific model, providing a method to create chat requests and ensuring consistent interaction with the model.
