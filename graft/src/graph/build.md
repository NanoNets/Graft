# src/graph/build.ts · [[error-handling-and-reporting]] [[graph-construction]]

This file defines the logic to build a graph representation from source code files in a repository.

- GraphBuildOptions · interface · L23-L36 — This interface specifies options for customizing the graph build process, including output directory and summarization settings.
- GraphBuildResult · interface · L38-L51 — This interface outlines the structure of the result returned from the graph build process, detailing the generated graph's metadata and statistics.
- listSourceFiles · function · L54-L56 — This function retrieves a list of source files from a given directory, excluding the output directory and unsupported languages.
- readGoModules · function · L62-L76 — function readGoModules(root: string): GoModule[]
- buildGraph · function · L78-L183 — This function orchestrates the process of reading source files, extracting nodes and edges, and writing the resulting graph to a file.
