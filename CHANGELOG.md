# Changelog

## 0.6.0

Consolidates the structural-traversal surface and wires the MCP server into
Claude Code. **Breaking** — see migration below.

### Breaking

- **Removed `graft callees` and `graft impact`.** Both fold into `graft callers`:
  - `graft callees <symbol>` → `graft callers <symbol> --direction out`
  - `graft impact <symbol> -d N` → `graft callers <symbol> --depth N`
  - `graft callers` with no new flags is unchanged (defaults `--direction in --depth 1`).
- **Removed MCP tools `graft_callees` and `graft_blast_radius`.** The `graft_callers`
  tool now takes optional `direction` (`in`|`out`, default `in`) and `depth`
  (default `1`) parameters covering both:
  - callees → `graft_callers { direction: "out" }`
  - blast radius → `graft_callers { depth: N }` (accepts a file path or symbol,
    same file-seed aggregation the old `graft_blast_radius` did).

  Rationale: a coding-agent tool-selection experiment showed agents never picked
  `graft_blast_radius`/`impact` (they reconstructed it by calling `callers`
  repeatedly) and never picked `callees` (they read the named file instead). One
  well-named command with flags is selected more reliably than three.

### Added

- `graft callers --direction <in|out>` — walk incoming (callers, default) or
  outgoing (callees) edges.
- `graft callers --depth <n>` — walk transitively out to depth N for the full
  blast radius (default 1 = direct edges only). For a file seed at depth >1 the
  walk aggregates over the symbols the file defines.
- `graft init` now registers the graft MCP server in the project's `.mcp.json`
  for Claude Code (previously Claude Code got only hooks + statusline + skill).
  Restart Claude Code to load it. Existing `.mcp.json` servers are preserved.

### Changed

- `graft mcp --help` and docs now list the full tool set
  (`graft_ask`, `graft_callers`, `graft_grep`, `graft_skeleton`, `graft_map`,
  `graft_check`) instead of only three.
- The bundled Claude Code skill and other-agent instructions document the
  consolidated `callers` flags.
