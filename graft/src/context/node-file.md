# src/context/node-file.ts · [[context-graph-management]]

This file defines the structure and operations for managing a context graph represented as markdown files.

- SourceRef · interface · L30-L33 — Represents a source file that contributed to the creation of a node, including its content hash.
- NodeLink · interface · L36-L40 — Defines a directed edge to another node, capturing the relationship and optional description.
- ContextNode · interface · L43-L58 — Models a single node in the context graph, encapsulating its metadata and relationships.
- Manifest · interface · L61-L71 — Represents the generated index of all nodes and their metadata for quick access and integrity checks.
- slugify · function · L81-L86 — Converts a display name into a URL-safe slug for use in file naming and linking.
- digestSources · function · L89-L95 — Calculates a SHA256 hash over the sorted lines of source file paths and hashes to ensure integrity.
- contextDirFor · function · L100-L103 — Determines the absolute path for the graft directory in a repository, allowing for file operations.
- renderGenerated · function · L106-L118 — Generates the markdown content for the summary and related links of a node.
- defaultHuman · function · L121-L123 — Provides a default human-readable section for a new node, which is preserved in future generations.
- renderNodeFile · function · L126-L141 — Serializes a node into its complete markdown file format, including generated and human sections.
- preserveHuman · function · L148-L152 — Extracts the human region from an existing node file to ensure it is not lost during regeneration.
- writeNode · function · L158-L169 — Writes a node to disk, preserving any existing human content and ensuring directory structure.
- ParsedNode · interface · L172-L179 — Represents a parsed node file, capturing essential metadata without the body content.
- readNodes · function · L182-L198 — Reads and parses all markdown node files in a specified directory, returning their metadata.
- existingNodeSlugs · function · L201-L208 — Lists the slugs of existing node files in a directory, aiding in the management of deleted nodes.
- deleteNode · function · L211-L214 — Deletes a specified node file from the filesystem, if it exists.
- writeManifest · function · L216-L219 — Writes the manifest file to disk, containing metadata about the context graph.
- readManifest · function · L221-L229 — Reads and parses the manifest file from disk, returning its contents or undefined if not found.
