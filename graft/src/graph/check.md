# src/graph/check.ts · [[context-graph-management]]

This file contains logic to verify if the committed graph is in sync with the current codebase, ensuring that any discrepancies are reported for CI purposes.

- GraphCheckResult · interface · L27-L37 — This interface defines the structure of the result returned by the graph check, detailing the state of the graph in relation to the code.
- GraphCheckOptions · interface · L39-L41 — This interface provides optional parameters for configuring the context directory when performing a graph check.
- checkGraph · function · L43-L101 — This function checks if the current code's graph representation matches the committed graph, identifying any added, removed, or changed nodes.
- formatGraphCheckReport · function · L104-L135 — This function generates a human-readable report summarizing the results of the graph check, indicating any discrepancies found.
