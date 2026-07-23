# src/graph/write.ts

This file manages the serialization and deserialization of a wiring graph, ensuring efficient storage and retrieval of graph data for further processing.

- wiringPath · function · L20-L22 — Generates the absolute path for the wiring graph file in a specified output directory.
- readGraph · function · L28-L34 — Reads and parses an existing wiring graph from a file, returning null if the file is absent or unparseable.
- writeGraph · function · L36-L46 — Writes a serialized and sorted representation of the graph to a JSON file, optimizing for size by stripping unnecessary data.
- stripBodyText · function · L57-L61 — Removes the body_text property from a node to reduce the size of the serialized graph, avoiding duplication of data already stored elsewhere.
- edgeOrder · function · L63-L69 — Defines the sorting order for edges in the wiring graph based on source, relation, and target.
