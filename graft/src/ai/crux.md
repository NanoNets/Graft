# src/ai/crux.ts · [[code-summarization]]

This file defines a system for summarizing code definitions to aid engineers in navigating a codebase.

- NodeRef · interface · L21-L27 — Defines the structure for referencing a node in the code graph.
- FileCruxInput · interface · L29-L33 — Encapsulates the input data required for summarizing a file's code definitions.
- NodeCrux · interface · L35-L40 — Represents the summarized information for a code definition in the file.
- CruxSummarizer · interface · L42-L44 — Interface for summarizing code definitions from a file.
- numberLines · function · L81-L88 — Formats the source code into a numbered string for better readability.
- userContent · function · L90-L99 — Constructs a user content string that includes file details and target nodes.
- parseResults · function · L102-L114 — Transforms the tool's parsed argument object into a structured list of NodeCrux objects for further processing.
- num · function · L104-L104 — This function converts a potentially non-finite number to a finite integer or zero, ensuring valid numerical output.
- ChatCruxSummarizer · class · L117-L140 — Implements a summarizer that utilizes a ChatModel to describe code definitions and their purposes in a file.
- constructor · method · L118-L118 — Initializes the ChatCruxSummarizer with a specific ChatModel instance for generating summaries.
- describeFile · method · L120-L139 — Processes a file input to generate summaries of its target definitions using the ChatModel.
