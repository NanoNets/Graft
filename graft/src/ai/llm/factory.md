# src/ai/llm/factory.ts

Creates instances of ChatModel based on the specified provider configuration, enabling flexible integration with different chat model APIs.

- ProviderKind · type · L12-L12 — Defines the types of providers for chat models, ensuring compatibility with specific APIs.
- ChatModelConfig · interface · L14-L21 — Specifies the configuration required to create a chat model, enforcing necessary parameters for initialization.
- createChatModel · function · L23-L39 — Creates an instance of a chat model based on the specified provider, handling different implementations accordingly.
