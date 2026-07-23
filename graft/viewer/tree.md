# viewer/tree.ts · [[graph-visualization]]

Generates a collapsible tree view of a code graph's hierarchy, allowing users to navigate through files, classes, and methods.

- esc · function · L7-L9 — Escapes special HTML characters in a string to prevent rendering issues in the tree view.
- renderOutline · function · L11-L66 — Renders the outline view of the code graph, managing the display of files and their hierarchical relationships.
- kids · function · L18-L22 — Retrieves the child nodes of a given parent node in the graph based on the 'contains' relationship.
- countDesc · function · L23-L26 — Counts the total number of descendant nodes for a given parent node, including its children and their descendants.
- row · function · L29-L42 — Constructs the HTML representation of a tree row for a given node, including its children and symbol count.
