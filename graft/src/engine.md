# src/engine.ts · [[error-handling-and-robustness]]

This file implements the Context Graph Engine, which builds and checks a code context graph from a repository without a database.

- InitOptions · interface · L26-L31 — Defines options for initializing the context graph build, including code extensions and a progress callback.
- CheckRunOptions · interface · L33-L35 — Specifies options for checking the context graph, allowing for code extensions to be included.
- GraphRunOptions · interface · L37-L41 — Holds options for running the graph build, including whether to use a Tier-2 LLM meaning pass.
- Graft · class · L43-L125 — The Graft class manages the context graph operations, including building and checking the graph against the codebase.
- constructor · method · L46-L48 — Initializes the Graft class with a configuration, resolving the necessary settings for the context graph.
- init · method · L51-L60 — Builds the context graph from the specified directory, utilizing various options and configurations.
- check · method · L63-L65 — Checks if the committed context graph is in sync with the code in the specified directory.
- checkGraph · method · L68-L70 — Verifies if the committed graph.json file is in sync with the code, focusing on the Tier-1 differences.
- graph · method · L77-L83 — Builds a per-symbol code graph in JSON format, optionally including a meaning layer based on the provided options.
- ask · method · L90-L92 — Processes a query against the committed graph, returning results based on structural and lexical rankings.
- requireKey · method · L95-L103 — Ensures that a valid OpenRouter API key is available, throwing an error if it is not set.
- synthesizer · method · L105-L108 — Retrieves the synthesizer instance, creating one if it is not already configured.
- cruxSummarizer · method · L111-L113 — Creates a crux summarizer for the code graph's Tier-2 pass, ensuring it is properly configured.
- summarizer · method · L115-L118 — Obtains the summarizer instance, initializing it if no custom summarizer is provided.
- modelLabel · method · L121-L124 — Determines the human-readable label for the active model used in the context graph.
