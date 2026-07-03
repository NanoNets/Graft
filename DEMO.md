# Context Graph Engine — Demo Guide

> Read this to understand what's been built and to run a clean demo today.

---

## 1. What this is, in one sentence

An **open-source library** that turns any pile of docs into a **structured context graph** — entities + typed relationships grounded in the source text — that AI agents **read from before doing work** and **write learnings back into**, so the shared knowledge compounds over time.

Think "durable, structured memory for a team of agents" — the same integration shape as ByteRover, but self-hosted, embedded, and runnable with a single `curl`.

---

## 2. What's been built (status)

| Piece | What it does | Status |
|-------|--------------|--------|
| **Core engine** (`src/engine.ts`) | `ingest` → `read` → `contribute` over a graph | ✅ Done |
| **Knowledge graph model** (`src/graph/`) | Nodes (entities), edges (typed relations), chunks (evidence), each with `confidence` + `observation` counts | ✅ Done |
| **Dedup + reinforcement** (`src/graph/merge.ts`) | New knowledge is matched to existing nodes by name/alias **and** embedding similarity; matches are merged & reinforced, not duplicated | ✅ Done |
| **Retrieval** (`src/retrieval/`) | Semantic match on entities → one-hop graph expansion → supporting passages → a ready-to-inject prompt block | ✅ Done |
| **Storage** (`src/graph/sqlite-store.ts`) | Embedded SQLite (`better-sqlite3`), zero infra; swappable behind a `GraphStore` interface | ✅ Done |
| **Local-first providers** (`src/ai/local.ts`) | In-process embeddings (transformers.js) + local extraction (Ollama) — **runs with no API keys** | ✅ Done |
| **Cloud auto-upgrade** (`src/engine.ts`) | If `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` are set, uses Claude + OpenAI automatically for higher quality | ✅ Done |
| **Three access modes** | Library, `context-graph` CLI, and `context-graph-mcp` MCP server for any agent | ✅ Done |
| **One-line installer** (`install.sh`) | `curl … | sh` clones, builds, and puts both commands on PATH | ✅ Done |
| Update modes (silent vs. flagged) | Deferred per your call — needs discussion | ⏸ Deferred |
| Delete / decay of stale nodes | In the spec, not yet built | ⬜ Not started |

**The whole codebase is commented** — every module has a doc comment explaining its role, and the non-obvious logic (dedup matching, reinforcement, chunk overlap, one-hop expansion) is annotated inline.

---

## 3. ⚠️ Before you demo: pick a provider

The engine needs a model for **extraction** (pulling entities/relationships out of text). Embeddings run locally with no setup, but extraction needs one of:

**Right now this machine has neither Ollama nor any API key set**, so pick one path first:

### Path A — Cloud (fastest to a clean demo, best quality) ✅ recommended for a live demo
```bash
export ANTHROPIC_API_KEY=sk-ant-...     # extraction via Claude
export OPENAI_API_KEY=sk-...            # embeddings via OpenAI (optional; local otherwise)
```
Reliable, fast, produces the richest graph. Best if you want the demo to look sharp.

### Path B — Fully local (the "no keys" story your manager asked for)
```bash
# install Ollama from https://ollama.com, then:
ollama pull llama3.2
```
No accounts, nothing leaves the machine. Slightly coarser graph and a one-time model download — this is the story to *tell*, but Path A is smoother to *show* live if you're short on time.

> Tip: you can do both — run the demo on cloud for polish, then flip `CONTEXT_GRAPH_LOCAL=1` and re-run one command to prove it also works with zero keys.

---

## 4. The demo (60 seconds)

The cleanest thing to show is the **library quickstart** — it's self-contained, uses an in-memory graph (leaves nothing behind), and tells the whole story in one run:

```bash
npm install
npm run example
```

It walks through, live:
1. **Ingest** a small "Payments Platform" doc → builds a graph of services and how they relate.
2. **Read** `"what happens when a charge fails?"` → prints a structured context block (entities + relationships + sources) ready to drop into an agent prompt.
3. **Contribute** a new learning (`"the Dunning Worker sends a Slack alert to #billing…"`) as if an agent discovered it mid-task.
4. **Read again** → the new knowledge is now part of the graph.

**The money moment:** step 3 doesn't just append text — the learning is extracted, deduped against existing entities, and merged. Re-observed facts get their `confidence` and `observation` count bumped instead of creating duplicates. That's the "gets smarter over time" claim, demonstrated.

### CLI version (if you'd rather show the shell)
```bash
npm run build

echo "Our billing worker retries failed charges 3x, then marks the subscription past_due." \
  | node dist/cli.js --db ./demo.db ingest-text --title "Billing"

node dist/cli.js --db ./demo.db query "how are failed charges handled?"

node dist/cli.js --db ./demo.db contribute \
  "After the final retry the billing worker posts a Slack alert to #billing." --agent oncall

node dist/cli.js --db ./demo.db query "how does the team find out about failed charges?"

node dist/cli.js --db ./demo.db stats
```
(Delete `demo.db*` afterward to reset.)

### MCP version (if the audience cares about agent integration)
Point Claude Code / Cursor at the server and the agent gets four tools — `context_read`, `context_contribute`, `context_ingest`, `context_stats`. The pitch: **read context → do the task → contribute what you learned**, on a shared team graph. Config is in the README.

---

## 5. Talking points (what to say while it runs)

- **"It's a graph, not a bag of chunks."** A vector store gives you similar snippets. This gives an agent *structure* it can reason over — what things are, and how they connect — plus the source passages as evidence.
- **"Agents write back."** Most RAG is read-only. Here an agent contributes a learning and it's merged into shared knowledge with provenance, so the next agent benefits.
- **"It compounds."** Confidence + observation counts mean the tenth confirmation of a fact strengthens it; one-off noise stays low-confidence. The graph curates itself.
- **"Zero infrastructure, one command."** Embedded SQLite, in-process embeddings, `curl | sh`. No database to stand up, no keys required to start. Cloud is an *upgrade*, not a requirement.
- **"TypeScript & MCP-native."** Most comparable OSS (Graphiti, GraphRAG, Cognee, mem0) is Python and/or server/cloud-oriented. This slots directly into a JS/TS agent stack and speaks MCP out of the box.

---

## 6. One loose end before publishing

`install.sh` and the README's `curl` command still contain a placeholder repo URL:

```
https://github.com/YOUR_ORG/context-graph-engine.git
```

Once this is pushed to GitHub, replace `YOUR_ORG/context-graph-engine` in **`install.sh`** and **`README.md`** (the local branch is `master`; the installer/README reference `main` — align those too). After that the one-line install is live. Not needed for today's demo — the library/CLI/MCP paths all run straight from the repo.

---

## 7. Where to look in the code

```
src/
  engine.ts            ← start here: ingest / read / contribute, provider selection
  ai/
    providers.ts       ← config resolution (constructor → env → defaults) + interfaces
    local.ts           ← key-free LocalEmbedder + OllamaExtractor
    anthropic.ts       ← Claude extraction (tool-calling)
    openai.ts          ← OpenAI embeddings
  graph/
    types.ts           ← the data model (nodes, edges, chunks) — read this to grok the domain
    merge.ts           ← dedup + reinforcement (the "gets smarter" logic)
    sqlite-store.ts    ← the embedded storage backend
  retrieval/retriever.ts ← semantic match + one-hop expansion + prompt rendering
  cli.ts               ← the CLI
  mcp.ts               ← the MCP server
examples/quickstart.ts ← the demo script from §4
```
