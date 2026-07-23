# src/graph/build.ts · [[error-handling-and-reporting]]

This file defines the logic for building a graph representation of a code repository, including parsing source files and resolving dependencies.

- GraphBuildOptions · interface · L23-L36 — This interface specifies options for customizing the graph build process, including output directory and summarization settings.
- GraphBuildResult · interface · L38-L51 — This interface outlines the structure of the result returned from the graph build process, detailing the generated graph's metadata and statistics.
- listSourceFiles · function · L54-L56 — This function retrieves a list of source files from a given directory, excluding the output directory and unsupported languages.
- readGoModules · function · L62-L76 — This function identifies and reads Go modules from the repository to facilitate edge resolution for Go import paths.
- buildGraph · function · L78-L183 — This function orchestrates the entire graph building process, from parsing source files to writing the final graph output.
