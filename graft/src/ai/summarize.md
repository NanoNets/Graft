# src/ai/summarize.ts · [[code-summarization]]

This file provides functionality to summarize source code files into concise prose for a knowledge graph, enhancing documentation and understanding of codebases.

- Summarizer · interface · L13-L15 — The Summarizer interface defines a contract for summarizing source code files.
- userContent · function · L28-L34 — The userContent function formats the source code and its path into a structured string for summarization.
- ChatSummarizer · class · L37-L51 — Provides a mechanism to summarize source code files into plain English for knowledge management.
- constructor · method · L38-L38 — Initializes the ChatSummarizer with a specific ChatModel for generating summaries.
- summarize · method · L40-L50 — Generates a summary of the provided source code using the specified ChatModel.
