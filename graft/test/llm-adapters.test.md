# test/llm-adapters.test.ts

This file contains tests for network-free adapters that simulate interactions with OpenAI and Anthropic SDKs, ensuring correct request handling and response formatting.

- fakeOpenAI · function · L17-L23 — Creates a mock OpenAI client for testing purposes, allowing assertions on the parameters sent to it.
- openAiResp · function · L25-L31 — Generates a mock response structure for OpenAI API calls, facilitating the testing of response handling.
- fakeAnthropic · function · L119-L125 — Creates a mock Anthropic client for testing purposes, enabling verification of the parameters it receives.
- anthropicResp · function · L127-L134 — Generates a mock response structure for Anthropic API calls, aiding in the testing of response processing.
