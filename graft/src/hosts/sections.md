# src/hosts/sections.ts · [[host-management-and-configuration]]

This file provides functionality to manage sections of text within files, specifically for inserting and updating content between defined markers.

- UpsertAction · type · L11-L11 — Defines the possible outcomes of an upsert operation on a section, indicating whether it was created, appended, replaced, or unchanged.
- LineEnding · type · L13-L13 — Specifies the types of line endings that can be used in the text, ensuring compatibility with different operating systems.
- fencedBlock · function · L15-L21 — Creates a formatted block of text enclosed by specific markers, ensuring proper line endings and normalization of input.
- detectEol · function · L24-L26 — Determines the dominant line ending used in a given text, facilitating consistent handling of line breaks.
- markerLineIndex · function · L29-L34 — Finds the index of a specified marker in an array of lines, helping to locate the start and end of sections within the text.
- upsertSection · function · L36-L67 — Handles the logic for inserting or updating a section of text in a file, managing file creation, content comparison, and writing operations.
