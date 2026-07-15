# test/helpers.ts

This file provides test doubles for offline, deterministic testing of components without external dependencies.

- PassthroughSummarizer · class · L9-L13 — This class serves as a no-op summarizer that returns the input code unchanged for controlled testing.
- summarize · method · L10-L12 — This method returns the input code as-is, allowing tests to control the output precisely.
- BracketSynthesizer · class · L21-L50 — This class synthesizes a graph structure from simple markup, enabling tests to define the relationships between nodes explicitly.
- synthesize · method · L22-L49 — This method processes file summaries to create a structured representation of nodes and their relationships based on markup.
- ensure · function · L24-L31 — This function ensures that a node exists in the map, creating it if necessary, to maintain the graph structure.
- fakeProviders · function · L52-L54 — This function creates and returns instances of the test doubles for summarization and synthesis.
