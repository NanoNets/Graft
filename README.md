<div align="center">

<!-- placeholder: swap for the Graft logo asset when ready -->
<!-- <img src="assets/graft.png" alt="Graft" width="220"/> -->

# Graft

**Your coding agent reads 30 files to change 3.**
**Graft gives it the map it should have read first.**

<p>
  <a href="https://www.npmjs.com/package/@nanonets/graft"><img src="https://img.shields.io/npm/v/%40nanonets%2Fgraft?style=for-the-badge&logo=npm&logoColor=white&label=npm" /></a>
  <a href="https://www.npmjs.com/package/@nanonets/graft"><img src="https://img.shields.io/npm/dm/%40nanonets%2Fgraft?style=for-the-badge&logo=npm&logoColor=white&label=downloads" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/%40nanonets%2Fgraft?style=for-the-badge&logo=nodedotjs&logoColor=white" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-20C997?style=for-the-badge" />
  <img src="https://img.shields.io/badge/telemetry-none-546FFF?style=for-the-badge" />
</p>

<!-- placeholder: numbers pending a committed benchmark run, see Benchmark below -->
**31% fewer tool calls · 23% less cost · 17% lower latency.** That is what an agent gets from reading the graph first instead of going in cold.

</div>

<p align="center">
  <img src="assets/graft-terminal.png" alt="Two commands — npm install and graft init — then Graft rides along in a Claude Code session, statusline synced" width="820"/>
</p>

---

## Quick start

```bash
npm install -g @nanonets/graft   # install the CLI, once
graft init                       # build the graph + wire it into Claude Code
```

That is the whole setup. `graft init` builds `graft/` from your code and drops a statusline and hooks into `.claude/`, so from the next session on Graft rides along in Claude Code: it pulls the matching nodes into each prompt and rebuilds the graph in the background after every turn. No daemon, no re-indexing to remember, nothing to run or maintain by default — the graph is just files.

Commit `graft/` so everyone who clones the repo (and their agents) gets the map:

```bash
git add graft && git commit -m "add context graph"
```

Prefer not to install globally? `npx @nanonets/graft init` works the same way.

---

## Agent integration

One command wires Graft into the coding agents you use:

```bash
npx @nanonets/graft init
# detects your agents and writes each one's native instruction file;
# Claude Code additionally gets the live statusline + hooks below
```

`init` auto-detects which agents are present (via their config directories) and writes a marker-fenced Graft section into each one's shared instruction file — `AGENTS.md`, `GEMINI.md`, `.github/copilot-instructions.md` — or a wholly-owned rule file for the agents that use one — `.cursor/rules/graft.mdc`, `.kiro/steering/graft.md`, `.windsurf/rules/graft.md`. Re-running only updates Graft's own section (or replaces the owned file) and never touches the rest of your content.

| Flag | Effect |
|---|---|
| `--agents <ids...>` | wire only these — ids: `agents`, `cursor`, `gemini`, `copilot`, `kiro`, `windsurf`, `claude` |
| `--all-agents` | write instruction files for every known agent, detected or not |
| `--no-agents` | Claude Code wiring only; skip other agents |
| `--list-agents` | print the known agent ids and exit |
| `--no-mcp` | skip MCP server registration |
| `--no-hooks` | skip hook installation |

### MCP server

`graft init` also registers Graft's MCP server with agents that support it, so
`graft_ask`, `graft_check`, and `graft_blast_radius` appear as native tools —
no shell required. Skip with `--no-mcp`. Run it manually with `graft mcp [dir]`,
or register it by hand:

```json
{ "mcpServers": { "graft": { "command": "npx", "args": ["-y", "@nanonets/graft", "mcp"] } } }
```

Where a CLI agent supports user-level `hooks.json`, `init` also installs Graft's post-edit hook — blast-radius warnings and automatic `$0` graph re-sync after edits (skip with `--no-hooks`).

### Claude Code (deep integration)

`graft init` always wires up Claude Code, and Claude Code gets more than an instruction file. From then on, any Claude Code session opened in the repo gets:

- **a live statusline** — graph size, % enriched, and a `⚠ N stale` warning when the code has moved ahead of the graph
- **auto-sync** — after you edit code, Graft rebuilds the graph in the background at the end of the turn (structural, `$0` — it never calls the LLM on its own)
- **context on tap** — each prompt pulls the matching nodes into the session; editing a file surfaces what depends on it ("blast radius"); new sessions start with the repo map

`graft init` is idempotent and never clobbers your existing `.claude/settings.json` — it merges its blocks and leaves the rest alone. Want the LLM summaries too? Run `graft build --deep` (with a key) whenever you like; auto-sync will never do it for you.

---

## The problem

Every task, your coding agent starts blind. Before it changes anything, it re-explores the repo: grep a term, open a file, follow an import, back out, try again. It is rebuilding a picture of a codebase it mapped an hour ago and threw away. That rediscovery burns most of a run's tool calls, tokens, and latency, and it is pure overhead:

- **Repeated.** Every task pays the exploration cost again, from zero.
- **Discarded.** Whatever the agent figured out dies with the session.
- **Unshared.** The next teammate, and their agent, start from scratch too.

Humans onboard to a codebase once. Agents onboard every single time.

---

## What Graft does

Graft builds that understanding **once** and writes it into your repo as a folder of linked markdown files, one node per system, API, or concept.

- **Real explanations, not a list of symbols.** Each node says, in plain English, what a part of the system does and how it connects to the rest, the way a senior engineer would explain it. That is the part an agent actually needs so it can skip the exploration. It is not a dump of function names.
- **A real graph you can read.** No embeddings, no similarity search, no index to keep warm. The graph is a set of linked files your agent opens, greps, and follows, exactly the way it reads any other file in the repo.
- **Grafted into git.** The graph is just files in `graft/`. Commit it, and anyone who clones the repo has it. No database, no server, no setup. Git does the syncing, and a stale graph shows up as a diff in review instead of rotting in some external store.
- **The diff lives with the code.** When a change moves things around, you see it in the graph diff in the same pull request, right next to the code that caused it.
- **Your key, your model.** Summaries are written by a model you pick on [OpenRouter](https://openrouter.ai), under your own key. The structural code graph (`graft build`, `graft check`) is deterministic tree-sitter and never calls a model at all.

---

## How the graph gets built

Graft builds the graph in two passes, both powered by a language model:

1. **Read each file.** Every source file is summarized once into a short description of what it does.
2. **Group into nodes.** Those summaries are grouped into a curated set of nodes (subsystems, key files, and concepts) with typed links between them. Graft chooses the right level of detail for you instead of making one node per file, so a big repo becomes a few dozen readable nodes.

Both passes are cached by content hash. Re-running only touches the files that changed, so the second build is fast and cheap.

Alongside the markdown graph, `graft build` builds `graft/.graph/wiring.json` — a per-symbol code graph — plus a per-file wiring card mirroring your source tree. Tier 1 is pure tree-sitter (every function, class, and call edge; deterministic, no model, no network), which is why plain `graft build` needs no key. The `--deep` pass adds a one-line summary and a crux excerpt per symbol, cached by body hash.

---

## What's in a node

A node is a single markdown file. Most code maps stop at an address: this thing lives in that file, on that line. That tells an agent where to look, not what it will find, so it still has to open the source and read. A Graft node holds the meaning inline, so the agent learns what it needs up front and opens the file only when it wants more.

Each node holds:

| Part | What it holds |
|---|---|
| **Summary** | A plain-English explanation of what the code does, written by the model and cached. It is there whether or not the code was ever documented, and it is regenerated when the source changes. |
| **Crux** | The handful of lines that actually carry the logic: the guard, the skip condition, the state change. Lifted straight from the source and stored inline, so the agent sees *how* it works, not just what. |
| **Sources** | The exact files the node is built from, each tracked by a content hash, so Graft can tell precisely when a node has gone stale. |
| **Links** | Typed connections to other nodes (`depends_on`, `part_of`, `uses`, `implements`, `produces`), written as `[[wikilinks]]` your agent can follow. |
| **Notes** | Anything you write below the generated block. It is preserved across regenerations, so your own context is never overwritten. |

That is three depths in one file: the summary says *what* the code does, the crux shows *how*, and the sources point to the rest if the agent needs it. A plain index makes it read a whole file to learn one thing. A Graft node hands it the answer inline, and the follow-up read often never happens.

The crux is stored as the code itself, not as a line range, on purpose. Line numbers drift whenever unrelated code above them shifts, but the lines that matter do not. Keeping the text, not the numbers, means the crux stays correct even as the file around it moves.

_Summary, sources, links, and notes ship today in markdown nodes. The crux ships per-symbol in the code graph (`graft build --deep`); inlining it into markdown nodes is next._

---

## Keeping it honest (CI)

A graph that has drifted from the code is worse than no graph. `graft check` compares each node's tracked source hashes against the current files and fails if the graph is stale. Drop it in CI so a pull request cannot merge with an out-of-date map.

```bash
graft check          # exits non-zero if graft/ has drifted
graft check --json   # machine-readable drift report
```

When the wiring graph exists, `graft check` validates it too — structural drift (symbols added, removed, or changed since the last `graft build`) and stale summaries both fail the check. A repo without a wiring graph is not penalized; the markdown graph stands alone.

<!-- placeholder: planned, not yet in the CLI -->
> **Planned: auto-regen on PR.** A single CI bot will regenerate changed nodes on a pull request and push the update, so the graph stays current without anyone remembering to run `build`. Until then, regenerate with `graft build --deep` and commit it alongside your code.

---

## What runs where

- **On your machine, no key, no network:** the structural code graph. `graft build` (wiring graph + per-file cards), `graft check`, and `graft ask` are deterministic tree-sitter — they never call a model.
- **Through your OpenRouter key:** the LLM-written parts — `graft build --deep` adds the concept nodes (file summaries + node synthesis) and the per-symbol summaries and cruxes. Set `OPENROUTER_API_KEY` and optionally pick the model with `GRAFT_OPENROUTER_MODEL` (default: `openai/gpt-4o-mini`).
- **No telemetry** and no analytics — the only network calls are the LLM requests you configured.

See [`.env.example`](.env.example) for the full list of settings (model, base URL, graph directory).

---

## CLI

```bash
graft build [dir]                    # build graft/ from the code at [dir]: wiring graph + per-file cards (no LLM, no key)
graft build --deep                   # add the LLM layer: concept nodes + per-symbol summary/crux (cached)
graft build --extensions .ts .py     # only include these code extensions

graft ask "<task>" [dir]             # query the graph — ranked nodes + exact file:line (no LLM, no key)
graft ask "<task>" --json            # machine-readable result

graft callers <symbol> [dir]         # who calls/references/imports/implements/extends a symbol (no LLM, no key)
graft callees <symbol> [dir]         # what a symbol calls/references/imports/implements/extends (no LLM, no key)
graft impact <symbol> [dir] -d N     # BFS over incoming edges — who breaks if this symbol changes (no LLM, no key)

graft grep "<regex>" [dir]           # exhaustive regex search over indexed files, grouped by enclosing symbol (no LLM, no key)
graft grep "<regex>" --in <path>     # narrow to files whose path contains this substring
graft grep "<regex>" -i --fixed      # case-insensitive; treat the pattern as a literal string, not a regex

graft map [dir]                      # token-budgeted repo orientation — dir clusters, hubs, hotspots (no LLM, no key)
graft map --max-dirs N               # raise/lower the number of directories shown

graft check [dir]                    # fail (exit 1) if graft/ has drifted from the code
graft check --json                   # print the drift report as JSON

graft viz [dir]                      # see the graph: serves an interactive viewer on localhost
graft viz --port 5000 --no-open      # pick a port; don't auto-open the browser

graft init [dir]                     # wire Graft into the coding agents detected in this repo (Claude Code always gets full hooks + statusline)
graft init --no-build                # wire the files only; don't build the graph
graft init --agents cursor kiro      # wire only these agents (ids: agents, cursor, gemini, copilot, kiro, windsurf, claude)
graft init --all-agents              # wire every known agent, detected or not
graft init --list-agents             # list known agent ids and exit

graft version                        # print the installed + latest published npm version
graft upgrade                        # npm install -g the latest published version

# global
graft --dir <path>                   # use a context dir other than <repo>/graft
graft --version, -v                  # print the installed version and exit
```

Method calls resolve through the receiver's type — constructor assignments
(`self.router = APIRouter()`) and type annotations, not just the call-site
name — so `callers`/`impact`/`grep --in` return calls bound to the right
type on method-heavy code, not every method anywhere with that name.

## Search & orient (`graft grep` / `graft map`)

`graft grep "<regex>"` is exhaustive over every indexed file and groups hits
by enclosing symbol, ranked by the same in-edge coupling `graft map` uses —
built for "every occurrence of this pattern" tasks where `graft ask`'s
ranked top-N isn't enough:

```
"NEEDLE" — 2 hits in 2 symbols across 1 files (searched 1 indexed files)

heavilyCalled · function · src/a.ts:L1-L3 · 3 in-edges
  L2: console.log("NEEDLE hit in heavilyCalled");

rarelyCalled · function · src/a.ts:L4-L6 · 0 in-edges
  L5: console.log("NEEDLE hit in rarelyCalled");
```

`graft map` is a token-budgeted first look at a repo — directory clusters
with file/symbol counts, each dir's local hubs, and the global hotspots —
all ranked by in-degree, no LLM, no key:

```
repo map — 105 files · 582 symbols · 1815 edges · typescript

src/                54 files · 414 symbols   hubs: set (bindings.ts, 38←), contextDirFor (node-file.ts, 11←), wiringPath (write.ts, 10←)
test/               36 files · 68 symbols   hubs: edge (graph-traverse.test.ts, 4←), graphOf (graph-traverse.test.ts, 4←), nodeStub (graph-traverse.test.ts, 3←)
viewer/             5 files · 58 symbols   hubs: $ (main.ts, 9←), activeGraph (main.ts, 5←), cvar (data.ts, 5←)
bench/              8 files · 42 symbols   hubs: makeClient (llm.ts, 3←), buildMarkdown (report.ts, 2←), judge (judge.ts, 2←)
scripts/            2 files · 0 symbols

hotspots: set · method · src/graph/bindings.ts:L21-L23 · 38←  contextDirFor · function · src/context/node-file.ts:L100-L103 · 11←  wiringPath · function · src/graph/write.ts:L20-L22 · 10←  ...
```

## Visualize it (`graft viz`)

`graft viz` opens a local, interactive view of both graphs — no install, no dev
server; the viewer ships prebuilt inside the package.

- **Context** tab — the architecture graph from `graft/*.md`. Nodes colored by
  type, sized by connectedness.
- **Code** tab — the per-symbol graph from `graft/.graph/wiring.json` (run `graft build` first).
- **Outline** tab — the file → class → method hierarchy as a collapsible tree.

Edges speak the code's language. Every link is one of a closed set of verbs, each
answering a question someone building or reviewing code actually asks:

| Verb | The question it answers |
|---|---|
| `part_of` / `contains` | where does this live? |
| `uses` / `calls` / `imports` / `depends_on` | what breaks if I change this? |
| `produces` | where does this output come from? |
| `configures` | what changes its behavior without a code change? |
| `validates` | what checks or judges this? (tests, drift checks, scoring) |
| `extends` / `implements` | what contract must this honor? |

Select a node and its edges take on direction: **amber = what it depends on,
teal = what depends on it**, with the verb written on each highlighted edge.
Chips above the canvas filter by verb; tree-sitter-extracted edges draw solid
while LLM-inferred ones draw dashed. The viewer live-reloads when `graft/`
changes on disk. Older graphs with vague verbs (`influences`, `supports`) are
normalized on load — no regeneration needed.

---

## Benchmark

<!-- placeholder: fill from a committed bench/results/ run before launch -->

The claim Graft has to earn is simple: an agent that reads the graph first is cheaper and faster without getting more answers wrong. The harness runs every task twice through the same agent with the same file tools. One run is **cold** (it explores from zero) and one is **graph** (it gets the `graft/` bundle up front). A separate model judges correctness, with a required-keyword floor so a fast-but-wrong answer cannot win.

| Metric | Cold | Graph | Change |
|---|---|---|---|
| Tool calls | _TBD_ | _TBD_ | **−31%** |
| Cost | _TBD_ | _TBD_ | **−23%** |
| Latency | _TBD_ | _TBD_ | **−17%** |
| Correctness | _TBD_ | _TBD_ | _at least as good as cold_ |

_The numbers above are placeholders pending a committed run._ Reproduce it yourself:

```bash
npm run bench -- --smoke   # 1 corpus, 1 task, a quick plumbing check
npm run bench              # full: all corpora, all tasks
```

See [`bench/README.md`](bench/README.md) for the method and how to add your own repo.

---

## Development

```bash
git clone https://github.com/NanoNets/context-graph-engine.git && cd context-graph-engine
npm install
npm run build
npm test

npm run cli -- build --deep .      # run the CLI from source
```

---

## License

MIT. See [LICENSE](LICENSE).
