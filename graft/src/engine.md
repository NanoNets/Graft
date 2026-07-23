# src/engine.ts · [[error-handling-and-reporting]]

The Graft class manages the construction and validation of a context graph from a code repository, ensuring it remains in sync with the codebase.

- InitOptions · interface · L28-L33 — Defines options for initializing the context graph build, including code extensions and a progress callback.
- CheckRunOptions · interface · L35-L37 — Specifies options for checking the context graph, allowing for code extensions to be included.
- GraphRunOptions · interface · L39-L45 — Defines options for running the graph building process, including LLM usage and concurrency settings.
- Graft · class · L47-L146 — Manages the context graph operations, including building and checking synchronization with the codebase.
- constructor · method · L50-L52 — Initializes the Graft class with a configuration, resolving the necessary settings for the context graph.
- init · method · L55-L64 — Builds the context graph from the specified directory, utilizing various options and configurations.
- check · method · L67-L69 — Checks if the committed context graph is in sync with the code in the specified directory.
- checkGraph · method · L72-L74 — Verifies if the committed graph.json file is in sync with the code, focusing on the Tier-1 differences.
- graph · method · L81-L88 — Builds a per-symbol code graph from the repository, optionally using a meaning layer with LLM.
- ask · method · L95-L103 — Processes a query against the context graph, returning results based on structural and lexical analysis.
- chatModel · method · L108-L125 — Retrieves the configured chat model or throws an error if the API key is missing, ensuring proper setup for LLM operations.
- synthesizer · method · L127-L129 — Provides the synthesizer for generating responses, defaulting to a chat synthesizer if none is configured.
- cruxSummarizer · method · L132-L134 — Returns a crux summarizer for the Tier-2 pass of the code graph, ensuring detailed summarization of nodes.
- summarizer · method · L136-L138 — Fetches the summarizer for generating summaries, defaulting to a chat summarizer if not explicitly set.
- modelLabel · method · L141-L145 — Determines the human-readable label for the active model, which is recorded in the manifest for reference.
