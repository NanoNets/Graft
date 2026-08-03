# Changelog

## Unreleased

### Fixed

- **Windows: path scoping and `map` work again.** graft stores a repo-relative path
  for every indexed file — in node ids, `node.path`, the extract cache, the freshness
  fingerprint — and it was produced with `relative()`, which returns the *platform*
  separator. So on Windows every stored path was `src\gate.ts`, while the query layer
  parses those strings with `/` by hand. Nothing errored; it just matched nothing:

  - `ask --in <path>` reported `nothing indexed under "…"` for **every** prefix,
    making path scoping unusable on the platform ([#33]).
  - `map` saw one path segment instead of several, so it emitted one single-file
    "directory" per file — on a large repo spending its whole token budget describing
    ~16 arbitrary files instead of the repo's shape ([#35]).
  - `callers <file.ts>`-style filename lookups missed.

  Repo-relative paths are now normalized to posix once, where they are created
  (`src/util/paths.ts`), instead of defensively at each consumer. Mac and Linux are
  unaffected — the conversion is the identity there, and existing graphs are
  byte-identical. **On Windows every cache key changes**, so the first `graft build`
  after upgrading re-parses the repo once and `graft check` may report drift until it
  runs. One-time, and `graft/` is a local gitignored cache — nothing to migrate.

  CI now runs a `windows-latest` leg, because this whole class of bug is invisible to
  a posix-only matrix.

### Changed

- **`--in` means the same thing on every command.** `ask --in` matched a segment-aware
  path prefix while `grep --in` and `callers --in` matched a bare substring, so
  `grep --in src` also swept up `lib/mysrc/`. All three now use the prefix rule, and
  all three accept either separator (`--in server\src\gpu` works on Windows). A prefix
  matching nothing indexed is now a loud error on all three rather than — for `grep`
  and `callers` — empty output the caller had to interpret.

  This is stricter: a mid-path fragment like `--in gpu` for `server/src/gpu` no longer
  matches. Pass a real prefix (`--in server/src/gpu`), a full file path
  (`--in src/a.ts`), or use `grep`'s pattern to match on content.

[#33]: https://github.com/NanoNets/Graft/issues/33
[#35]: https://github.com/NanoNets/Graft/issues/35

## 0.8.2

### Fixed

- **`graft ask` no longer buries source under test files on pytest-style repos.** The
  test-de-rank (`isTestPath`) matched test directories (`tests/`, `spec/`) and suffix
  names (`_test`, `.test`, `.spec`) but missed Python's dominant `test_*.py` filename
  **prefix** and `conftest.py`. On repos whose tests live outside a `tests/`-named
  directory (e.g. a `t/unit/` layout), tests were not de-ranked and swamped `ask`
  results. The prefix and `conftest.py` are now recognized.

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

### Fixed

- **A git worktree is no longer blind.** `graft/` is gitignored, so `git worktree add`
  never checks it out — and the graph is the only thing the MCP tools read. Every tool in
  a fresh worktree answered `no matching nodes` / `no graph found` for the whole session,
  and `INDEX.md` and the cards were missing too, so `grep` and the repo map came up empty.

  A query in a worktree now copies the parent checkout's graph and query sidecars in, then
  treats the difference between the two checkouts as ordinary drift. The worktree's `.git`
  is a file naming its parent, so there is nothing to configure; the copy is $0 and
  offline, and the Tier-2 meaning layer survives it (a cold rebuild would have thrown away
  every summary you paid for and re-parsed the repo). `graft build` in a worktree starts
  from the same copy, so it is incremental too — and it is what writes the worktree's
  cards and `INDEX.md`, generated from *this* checkout's code rather than copied from the
  parent's branch. A query still writes only what a query reads.

  Reads the parent, never writes to it. No-ops unless there is genuinely a built parent
  checkout on disk — a fresh clone, CI, or a cloned (rather than worktree'd) cloud session
  behaves exactly as before. `GRAFT_NO_SEED=1` turns it off.

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
