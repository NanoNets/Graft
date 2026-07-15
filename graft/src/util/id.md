# src/util/id.ts

This file provides utility functions for generating unique identifiers, creating content hashes, and normalizing names for consistent matching.

- newId · function · L4-L6 — This function generates a unique identifier with a specified prefix, solving the need for easily identifiable and unique keys.
- contentHash · function · L9-L11 — This function creates a stable hash of the input content, which is essential for deduplication of documents.
- normalizeName · function · L14-L16 — This function normalizes names for case- and whitespace-insensitive matching, ensuring consistency in name comparisons.
