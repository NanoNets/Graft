# src/ai/synthesize.ts · [[code-summarization]]

This file defines the architecture for synthesizing a graph of nodes from file summaries, enabling better understanding and navigation of a codebase.

- SynthLink · interface · L12-L16 — Defines the structure of a directed edge between nodes, specifying relationships in the synthesized graph.
- SynthNode · interface · L19-L27 — Represents a node in the synthesized graph, encapsulating its name, type, summary, sources, and links to other nodes.
- FileSummary · interface · L30-L33 — Holds the summary information for a single file, including its path and a descriptive summary.
- Synthesizer · interface · L35-L37 — Defines the interface for synthesizers that convert file summaries into structured nodes.
- userContent · function · L93-L98 — Constructs a formatted string from an array of file summaries, ensuring it does not exceed a specified character limit.
- clean · function · L101-L123 — Normalizes and cleans a raw model response into a structured array of SynthNode objects.
- ChatSynthesizer · class · L128-L154 — The ChatSynthesizer class implements the Synthesizer interface to create a structured architecture graph using a chat model.
- constructor · method · L129-L129 — The constructor initializes the ChatSynthesizer with a specific chat model for generating architecture graphs.
- synthesize · method · L131-L153 — The synthesize method processes file summaries to produce a curated set of SynthNode objects representing the architecture of the codebase.
