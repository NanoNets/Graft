# graft — repo map

Small markdown nodes summarising this repo. `grep` any term, symbol, or
filename here, or run `graft ask "<task>"`. Each node carries prose plus exact
`file:line`; open a source file only to edit the named span.

## Concepts

- [agent](agent.md) — Agent · bench/agent.ts
- [benchmarking-system](benchmarking-system.md) — Benchmarking System · bench/agent.ts, bench/judge.ts, bench/llm.ts, bench/report.ts, bench/run.ts, bench/selfcheck.ts, bench/tasks.ts, bench/token-ab.ts
- [code-summarization](code-summarization.md) — Code Summarization · src/ai/crux.ts, src/ai/summarize.ts, src/ai/synthesize.ts
- [configuration-management](configuration-management.md) — Configuration Management · src/ai/providers.ts, src/claude/settings-merge.ts
- [deterministic-testing](deterministic-testing.md) — Deterministic Testing · test/helpers.ts
- [error-handling-and-reporting](error-handling-and-reporting.md) — Error Handling and Reporting · bench/run.ts, src/engine.ts, src/graph/build.ts
- [graph-data-integrity](graph-data-integrity.md) — Graph Data Integrity · test/graph-write.test.ts
- [graph-extraction-and-loading](graph-extraction-and-loading.md) — Graph Extraction and Loading · src/graph/extract.ts, src/graph/load.ts, src/graph/relations.ts, src/graph/resolve.ts, src/graph/types.ts
- [graph-ranking](graph-ranking.md) — Graph Ranking · test/graphrank.test.ts
- [graph-representation](graph-representation.md) — Graph Representation · src/graph/relations.ts, src/graph/types.ts
- [graph-serialization](graph-serialization.md) — Graph Serialization · test/graph-write.test.ts
- [graph-synchronization](graph-synchronization.md) — Graph Synchronization · src/context/check.ts, src/graph/check.ts
- [graph-traversal-and-analysis](graph-traversal-and-analysis.md) — Graph Traversal and Analysis · src/graph/traverse-cli.ts, src/graph/traverse.ts, src/search/grep-cli.ts, src/search/grep.ts
- [graph-traversal-and-impact-analysis](graph-traversal-and-impact-analysis.md) — Graph Traversal and Impact Analysis · test/graph-traverse.test.ts
- [graph-visualization](graph-visualization.md) — Graph Visualization · viewer/data.ts, viewer/detail.ts, viewer/graph.ts, viewer/main.ts, viewer/tree.ts
- [host-configuration-management](host-configuration-management.md) — Host Configuration Management · test/hosts-codex-hooks.test.ts, test/hosts-init.test.ts, test/hosts-mcp-config.test.ts, test/hosts-registry.test.ts, test/hosts-sections.test.ts
- [host-management-and-configuration](host-management-and-configuration.md) — Host Management and Configuration · src/hosts/codex-hooks.ts, src/hosts/init.ts, src/hosts/instructions.ts, src/hosts/mcp-config.ts, src/hosts/registry.ts, src/hosts/sections.ts
- [idempotent-host-initialization](idempotent-host-initialization.md) — Idempotent Host Initialization · test/hosts-init.test.ts
- [judge](judge.md) — Judge · bench/judge.ts
- [llm-integration](llm-integration.md) — LLM Integration · bench/llm.ts
- [mcp-server-and-tools](mcp-server-and-tools.md) — MCP Server and Tools · test/mcp-server.test.ts, test/mcp-tools.test.ts
- [report](report.md) — Report · bench/report.ts
- [self-check-mechanism](self-check-mechanism.md) — Self-Check Mechanism · bench/selfcheck.ts
- [tasks](tasks.md) — Tasks · bench/tasks.ts
- [test-helpers](test-helpers.md) — Test Helpers · test/helpers.ts
- [testing-and-validation](testing-and-validation.md) — Testing and Validation · test/ask-index.test.ts, test/ask.test.ts, test/claude-format.test.ts, test/claude-hooks.test.ts, test/claude-init.test.ts, test/claude-paths.test.ts, test/claude-settings-merge.test.ts, test/claude-shim-template.test.ts, test/claude-skill-template.test.ts, test/claude-state.test.ts, test/claude-stats.test.ts, test/claude-statusline.test.ts, test/cli-meta.test.ts, test/context.test.ts, test/covers.test.ts, test/graph-bindings.test.ts, test/graph-go.test.ts, test/graph-load.test.ts, test/graph-map.test.ts, test/graph-resolve-typed.test.ts, test/graph-traverse-cli.test.ts
- [token-a-b-testing](token-a-b-testing.md) — Token A/B Testing · bench/token-ab.ts
- [user-interaction-in-visualization](user-interaction-in-visualization.md) — User Interaction in Visualization · viewer/detail.ts, viewer/graph.ts, viewer/main.ts
- [visualization-and-serving](visualization-and-serving.md) — Visualization and Serving · src/viz/assemble.ts, src/viz/serve.ts

## Files

116 per-file wiring cards mirror the source tree under `graft/` (105 carry extracted symbols). They are deliberately not enumerated here —
`grep` a symbol or `find`/`ls` a filename under `graft/` to land on the card for that file.
