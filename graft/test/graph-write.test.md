# test/graph-write.test.ts · [[graph-data-integrity]] [[graph-serialization]]

This file contains tests to ensure that the `writeGraph` function correctly handles the serialization of graph nodes, specifically that the `body_text` field is omitted when unnecessary, while preserving other fields and the integrity of the original node object.

- makeNode · function · L19-L35 — Creates a node object with default properties, allowing for optional overrides, to facilitate testing of graph serialization and deserialization.
