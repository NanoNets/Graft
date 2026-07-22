# graft — repo map

Small markdown nodes summarising this repo. `grep` any term, symbol, or
filename here, or run `graft ask "<task>"`. Each node carries prose plus exact
`file:line`; open a source file only to edit the named span.

## Concepts

- [ai-model-integration](ai-model-integration.md) — AI Model Integration · bench/llm.ts
- [benchmarking-framework](benchmarking-framework.md) — Benchmarking Framework · bench/agent.ts, bench/judge.ts, bench/llm.ts, bench/report.ts, bench/run.ts, bench/selfcheck.ts, bench/tasks.ts
- [benchmarking-results-reporting](benchmarking-results-reporting.md) — Benchmarking Results Reporting · bench/report.ts
- [caching-mechanism](caching-mechanism.md) — Caching Mechanism · bench/agent.ts, bench/report.ts, src/context/build.ts
- [code-summarization-and-synthesis](code-summarization-and-synthesis.md) — Code Summarization and Synthesis · src/ai/crux.ts, src/ai/summarize.ts, src/ai/synthesize.ts
- [configuration-management](configuration-management.md) — Configuration Management · src/ai/providers.ts
- [error-handling-and-reporting](error-handling-and-reporting.md) — Error Handling and Reporting · bench/run.ts, src/graph/build.ts, src/graph/check.ts
- [graph-construction](graph-construction.md) — Graph Construction · src/context/build.ts, src/context/check.ts, src/graph/build.ts, src/graph/check.ts
- [graph-management](graph-management.md) — Graph Management · src/graph/write.ts
- [self-check-mechanism](self-check-mechanism.md) — Self-Check Mechanism · bench/selfcheck.ts
- [task-management](task-management.md) — Task Management · bench/tasks.ts
- [visualization-layer](visualization-layer.md) — Visualization Layer · viewer/data.ts, viewer/detail.ts, viewer/graph.ts, viewer/main.ts, viewer/tree.ts

## Files

105 per-file wiring cards mirror the source tree under `graft/` (94 carry extracted symbols). They are deliberately not enumerated here —
`grep` a symbol or `find`/`ls` a filename under `graft/` to land on the card for that file.
