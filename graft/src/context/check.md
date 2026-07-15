# src/context/check.ts · [[context-graph-management]]

This file provides functionality to verify if the committed context graph is synchronized with the current codebase, ensuring consistency in CI environments.

- CheckResult · interface · L22-L30 — Defines the structure of the result returned by the checkContext function, encapsulating the status and details of any discrepancies found.
- CheckOptions · interface · L32-L35 — Specifies optional parameters for the checkContext function, allowing customization of the context directory and file extensions to check.
- checkContext · function · L37-L107 — Checks the current state of the context graph against the recorded manifest, identifying any content drift, removals, or coverage issues.
- formatCheckReport · function · L110-L135 — Generates a human-readable report summarizing the results of the checkContext function, detailing any discrepancies found.
- short · function · L137-L139 — Shortens a hash string to its first eight characters for easier readability in reports.
