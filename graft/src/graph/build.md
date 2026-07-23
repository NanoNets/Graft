# src/graph/build.ts · [[error-handling-and-reporting]]

This file defines the logic for building a graph representation of a code repository, including parsing source files and resolving dependencies.

- applyMinSubstanceGuard · function · L32-L47 — function applyMinSubstanceGuard(scopes: ScopeV1[], nodes: NodeV1[]): ScopeV1[]
- GraphBuildOptions · interface · L49-L62 — This interface specifies options for customizing the graph build process, including output directory and summarization settings.
- GraphBuildResult · interface · L64-L77 — This interface outlines the structure of the result returned from the graph build process, detailing the generated graph's metadata and statistics.
- listSourceFiles · function · L80-L82 — This function retrieves a list of source files from a given directory, excluding the output directory and unsupported languages.
- readGoModules · function · L88-L102 — This function identifies and reads Go modules from the repository to facilitate edge resolution for Go import paths.
- buildGraph · function · L104-L215 — This function orchestrates the entire graph building process, from parsing source files to writing the final graph output.
