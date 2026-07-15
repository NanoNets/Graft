# src/ai/crux.ts · [[code-summarization-and-synthesis]]

This file provides a mechanism to summarize code definitions for better navigation and understanding of a codebase.

- NodeRef · interface · L21-L27 — Defines the structure for referencing a node in the code graph.
- FileCruxInput · interface · L29-L33 — Encapsulates the input data required for summarizing a file's code definitions.
- NodeCrux · interface · L35-L40 — Represents the summarized information for a code definition in the file.
- CruxSummarizer · interface · L42-L44 — Interface for summarizing code definitions from a file.
- numberLines · function · L63-L70 — Formats the source code into a numbered string for better readability.
- userContent · function · L72-L81 — Constructs a user content string that includes file details and target nodes.
- parseResults · function · L84-L98 — Parses the JSON response from the summarization model into a usable format.
- num · function · L88-L88 — This function converts a potentially non-finite number to a finite integer or zero, ensuring valid numerical output.
- OpenRouterCruxSummarizer · class · L101-L127 — Implements the CruxSummarizer interface using OpenAI's chat API for summarization.
- constructor · method · L105-L112 — Initializes the OpenRouterCruxSummarizer with API key and model.
- describeFile · method · L114-L126 — Generates summaries for the code definitions in a given file.
