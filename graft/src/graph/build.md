# src/graph/build.ts · [[context-graph-management]]

This file defines the logic to build a graph representation of a code repository, facilitating analysis and visualization of its structure.

- GraphBuildOptions · interface · L22-L33 — This interface specifies options for customizing the graph build process, including output directory and summarization behavior.
- GraphBuildResult · interface · L35-L48 — This interface outlines the structure of the result returned from the graph build process, detailing the generated graph's metadata and statistics.
- listSourceFiles · function · L51-L53 — This function retrieves a list of source files from a given directory, excluding the output directory and unsupported languages.
- buildGraph · function · L55-L143 — This function orchestrates the process of building a graph from source files, including parsing, enriching, and writing the graph data.
