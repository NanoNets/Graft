# Changelog

## 0.8.1

### Changed

- **Every graft query now refreshes the graph before it answers.** Freshness used to be the
  `Stop` hook's job — it rebuilt once the turn had ended — so every query an agent made
  between its first edit and the end of that turn answered from a graph that no longer
  matched the file it had just changed, and it stayed that way indefinitely if the
  background sync failed. Edits made outside the agent (your editor, a branch switch, a
  stash) set no flag at all, so the statusline read `✓ synced` while the graph was behind.

  `ask`, `grep`, `callers`, `skeleton` and `map` now stat the working tree against the last
  build's fingerprint (~3ms) and rebuild only if something moved. `check` is exempt — it is
  the drift report, and refreshing first would make it always say OK.

  A refresh writes only what a query reads: the wiring graph, the `ask` sidecar, and the
  freshness record. It does **not** rewrite the markdown cards, `INDEX.md`, or your
  `.gitignore` — a query is a read, and those stay the job of an explicit `graft build`
  (which is what the Claude Code `Stop` hook already runs at the end of a turn). So the
  retrieval tools are always current, while the markdown you might `grep` by hand can lag
  an edit until the turn ends.

  The refresh is structural and `$0`: it never calls the LLM, so `graft check` still reports
  concept-node drift and stale summaries until you run `graft build --deep` yourself. A
  refresh that fails answers from the graph on disk rather than failing the query.

  ```bash
  graft ask "..." --no-refresh     # answer from the graph exactly as it is on disk
  GRAFT_NO_REFRESH=1               # same, for every command in the process
  ```

### Added

- **Incremental extraction.** `graft build` memoizes each file's parse under `graft/.cache/`
  and replays the files whose bytes have not moved, so a rebuild costs roughly the files
  that changed: on this repo (124 files) **0.74s cold against 0.18s after one edit**. Output
  is byte-identical to a cold build. The memo is discarded automatically when the extraction
  code or the graft version changes, so a stale parse can't outlive an upgrade. `graft build`
  now reports `parsed: N of M files (K replayed from cache)`, and `graft build --no-reuse`
  forces a cold parse of everything.

  Only the *parse* is skipped — every file is still read and hashed on every build. A stat
  may decide whether a query bothers rebuilding; it may not decide what the rebuild itself
  looks at, or `graft check` (which always re-hashes) could report drift that the `graft
  build` it recommends refuses to repair.

- **`GRAFT_REFRESH=hash`** — confirm every file by hashing its contents instead of trusting
  size and mtime, for tooling that rewrites files while preserving both.

## 0.8.0

### Changed

- **`graft init` now asks which agents to wire, instead of writing files for every
  agent it detects.** Detection keyed off directories in `$HOME`, so anyone who had
  tried several coding CLIs got instruction files and MCP configs for all of them —
  plain `graft init` effectively behaved like `--all-agents`. On a terminal it now
  shows every known agent, which ones were detected, and the exact files each would
  write, and wires only what you select (Claude Code pre-selected).

  **Migration —** `graft init` in CI, a Dockerfile, or any non-interactive shell now
  writes **nothing** and prints the command to run instead. Add `--yes` for the old
  behaviour, or `--agents <ids>` to be explicit:

  ```bash
  graft init --yes                  # wire every detected agent (pre-0.8 default)
  graft init --agents claude        # or name them
  ```

### Added

- **`graft init --dry-run`** — print every path `init` would touch, then exit without
  writing. Out-of-repo writes get their own section.
- **`graft init --no-global`** — skip every write outside the repo. Selecting the
  `agents` host writes to `~/.codex/config.toml`, `~/.codex/hooks.json`, and
  `~/.codex/hooks/graft/`; those are user-level and apply to every repo you open with
  Codex, and previously nothing suppressed the `config.toml` write (`--no-hooks` only
  covered the other two). These are now labelled `machine-wide` in the picker.
- **`graft init --yes`** — wire every detected agent without prompting.

## 0.7.0

### Changed

- **`graft/` is now a local, git-ignored cache, not a committed artifact.** Every
  `graft build` adds `graft/` to the repo's `.gitignore` itself, so the graph is
  regenerated locally (like `node_modules`) rather than shared through git. Commit
  `.claude/` (hooks, skill, statusline, `.mcp.json`) so teammates' agents pick graft
  up; each teammate runs `graft build` for their own graph. `graft check` is now a
  local freshness signal rather than a CI merge gate.

### Removed

- The `bench/` benchmark harness is no longer part of the published repo.

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
