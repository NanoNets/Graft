---
name: Context Graph Management
slug: context-graph-management
type: system
sources:
  - path: src/context/build.ts
    hash: cfe11ecfeab1f69aad383db3a0a282a45033b61dc8b0af1ae80dc3d41687f0cb
  - path: src/context/check.ts
    hash: df6c8cb642ea53f533c4deeb1143932d74b36fa5eb424c3bac73f46aca95a312
  - path: src/context/node-file.ts
    hash: 32e046ecd962e8709c5795fc42e3934064da5f3acc5eb5df584188b37cbfd5b9
  - path: src/engine.ts
    hash: 9ce688dafb10d7d3acbad361c36f7b13be33a104721779d3d8bfcb431ca6e2e9
  - path: src/index.ts
    hash: 5e3bfb88d938f9fbfbcefd4917e15fa32fb09ab3bd06e9de5739d248416b054a
sources_digest: 2f4644c3979157085af4d66d5e6435e8e37100d180d5dd2b3519dbd7e01b96e2
links:
  - to: benchmarking-system
    relation: part_of
    description: Provides context management capabilities for benchmarking.
generator:
  version: 1
---
<!-- context:generated:start -->
## Summary

This system is responsible for building and maintaining a context graph from a codebase, ensuring that the generated content remains in sync with the underlying source files through initialization and verification processes.

## Related

- part of [[benchmarking-system]] — Provides context management capabilities for benchmarking.
<!-- context:generated:end -->

## Notes

_Anything written below the generated block is preserved when the graph is regenerated._
