# viewer/detail.ts · [[graph-visualization]] [[user-interaction-in-visualization]]

This file provides the logic to render a detailed view of a selected node in a graph, including its properties and relationships.

- esc · function · L8-L10 — This function sanitizes a string for safe HTML rendering by escaping special characters.
- renderDetail · function · L12-L58 — This function renders the details of a selected node, including its type, name, summary, sources, and relationships.
- name · function · L29-L29 — This function retrieves the name of a node by its ID, providing a fallback if not found.
- linkList · function · L40-L50 — This function generates HTML for displaying a list of links related to a node, categorized by their relationship type.
