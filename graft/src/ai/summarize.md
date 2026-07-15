# src/ai/summarize.ts · [[code-summarization-and-synthesis]]

This file provides functionality to summarize source code files into plain English for a knowledge graph.

- Summarizer · interface · L13-L15 — The Summarizer interface defines a contract for summarizing source code files.
- userContent · function · L28-L34 — The userContent function formats the source code and its path into a structured string for summarization.
- OpenRouterSummarizer · class · L37-L61 — The OpenRouterSummarizer class implements the Summarizer interface using OpenAI's chat API to generate summaries.
- constructor · method · L41-L48 — The constructor initializes the OpenRouterSummarizer with an API key and model for making API calls.
- summarize · method · L50-L60 — The summarize method generates a summary of the provided code by interacting with the OpenAI API.
