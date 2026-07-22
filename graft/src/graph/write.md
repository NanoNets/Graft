# src/graph/write.ts · [[graph-management]]

This file contains functions for managing the serialization and deserialization of a wiring graph used in a context directory.

- wiringPath · function · L20-L22 — Generates the absolute path for the wiring graph file in a specified output directory.
- readGraph · function · L28-L34 — Reads and parses an existing wiring graph from a file, returning null if the file is absent or unparseable.
- writeGraph · function · L36-L46 — Writes a sorted representation of the wiring graph to a specified output directory, ensuring the directory structure exists.
- stripBodyText · function · L57-L61 — function stripBodyText(node: NodeV1): NodeV1
- edgeOrder · function · L63-L69 — Defines the sorting order for edges in the wiring graph based on source, relation, and target.
