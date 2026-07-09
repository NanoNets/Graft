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
| **Cloud auto-upgrade** (`src/engine.ts`) | If `OPENROUTER_API_KEY` is set, uses OpenRouter for extraction automatically (any tool-calling model) for higher quality | ✅ Done |
| **PDF + directory ingestion** (`src/ingest/pdf.ts`) | `.pdf` parsed automatically (pure-JS `unpdf`, no native deps); `ingest-dir` walks a folder of mixed docs (PDF/MD/TXT) | ✅ Done |
| **Graph visualization** (`src/graph/export.ts`) | Export the whole graph to a self-contained interactive HTML page (also JSON / Mermaid) | ✅ Done |
| **Three access modes** | Library, `context-graph` CLI, and `context-graph-mcp` MCP server (7 tools) for any agent | ✅ Done |
| **Demo docs** (`examples/demo-docs/`) | 3 detail-rich PDFs + 1 Markdown glossary + a PDF generator script | ✅ Done |
| **One-line installer** (`install.sh`) | `curl … | sh` clones, builds, and puts both commands on PATH | ✅ Done |
| Update modes (silent vs. flagged) | Deferred per your call — needs discussion | ⏸ Deferred |
| Delete / decay of stale nodes | In the spec, not yet built | ⬜ Not started |

**The whole codebase is commented** — every module has a doc comment explaining its role, and the non-obvious logic (dedup matching, reinforcement, chunk overlap, one-hop expansion) is annotated inline.

---

## 3. ⚠️ Before you demo: pick a provider

The engine needs a model for **extraction** (pulling entities/relationships out of text). Embeddings run locally with no setup, but extraction needs one of:

**Right now this machine has neither Ollama nor any API key set**, so pick one path first:

### Path A — Cloud via OpenRouter (fastest to a clean demo, best quality) ✅ recommended for a live demo
```bash
export OPENROUTER_API_KEY=sk-or-...     # extraction (default model: openai/gpt-4o-mini)
export OPENAI_API_KEY=sk-...            # embeddings (optional; embeddings stay local otherwise)
```
Reliable, fast, produces the richest graph. One OpenRouter key covers extraction — embeddings run locally unless you also set an OpenAI key. Best if you want the demo to look sharp.

### Path B — Fully local (the "no keys" story your manager asked for)
```bash
# install Ollama from https://ollama.com, then:
ollama pull llama3.2
```
No accounts, nothing leaves the machine. Slightly coarser graph and a one-time model download — this is the story to *tell*, but Path A is smoother to *show* live if you're short on time.

> Tip: you can do both — run the demo on cloud for polish, then flip `CONTEXT_GRAPH_LOCAL=1` and re-run one command to prove it also works with zero keys.

---

## 4. The MCP demo (the main event)

This is the flow to show: **install → point Claude Code at a folder → "build a context graph" → Claude Code does it via MCP → open the visual graph → ask questions.** Verified end-to-end (OpenRouter extraction + local embeddings).

There are 4 demo docs already in `examples/demo-docs/` — a fictional "Northwind" company: 3 PDFs (architecture, billing runbook, onboarding) + 1 Markdown glossary. Regenerate the PDFs any time with `node scripts/make-demo-pdfs.mjs`.

### The 7 MCP tools Claude Code gets
| Tool | What Claude Code uses it for |
|------|------------------------------|
| `context_ingest_dir` | **Point at a folder → build the whole graph in one call** |
| `context_ingest_file` | Ingest specific files (incl. PDFs) by path |
| `context_ingest` | Ingest raw text |
| `context_read` | Answer a question from the graph |
| `context_contribute` | Write a new learning back into the graph |
| `context_export` | Write the graph to an interactive HTML file to show |
| `context_stats` | Report entity/relationship counts |

### Step 1 — Install
```bash
git clone git@github.com:NanoNets/context-graph-engine.git
cd context-graph-engine && ./install.sh
```
That builds and puts `context-graph` + `context-graph-mcp` on your PATH. (One command — no manual npm steps.)

### Step 2 — Point Claude Code at it
Add this to your Claude Code MCP config (`.mcp.json` in your project, or `claude mcp add`). Set a DB path for the demo graph and your OpenRouter key:

```json
{
  "mcpServers": {
    "context-graph": {
      "command": "context-graph-mcp",
      "env": {
        "CONTEXT_GRAPH_DB": "/absolute/path/to/northwind-demo.db",
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```
Restart Claude Code so it picks up the server and its 7 tools.

Alternatively, run one process for the web UI + MCP together with `context-graph serve` and point Claude Code at the HTTP endpoint (no per-session process to spawn):

```json
{
  "mcpServers": {
    "context-graph": { "type": "http", "url": "http://localhost:4680/mcp" }
  }
}
```

### Step 3 — Ask Claude Code to build the graph (just say this)
> "Use the context-graph tools to build a context graph from the folder
> `/abs/path/context-graph-engine/examples/demo-docs`, then show me the stats."

Claude Code calls **`context_ingest_dir`** on the folder. All 4 docs are parsed (PDFs included), chunked, embedded, and extracted into the graph — you'll watch the progress tick file-by-file. Result: **~62 entities and ~71 relationships** across 4 documents. (Progress notifications keep the call alive past the default 60s MCP timeout — a multi-file cloud ingest takes ~1–2 min.)

### Step 4 — Show the graph (the visual)
> "Export the context graph to `/tmp/northwind-graph.html` and tell me the path."

Claude Code calls **`context_export`**. Open the file:
```bash
open /tmp/northwind-graph.html
```
You get an **interactive, force-directed graph** — nodes colored by type (service, person, policy, metric…), sized by how often they were observed, draggable/zoomable, with hover tooltips showing each entity's summary and confidence. This is the "show the created context graph" moment.

### Step 5 — Ask questions (the payoff)
Ask Claude Code things that only live inside those docs. It calls `context_read` and answers — structured entities/relationships **and** the exact source passages:

- *"How are failed charges retried, and when does an account get suspended?"*
  → 3 retries with exponential backoff (1h / 6h / 24h) → `past_due` → suspended after 7 days.
- *"How long do access tokens last and what backs the Auth Service?"*
  → access tokens expire after 15 minutes; Auth Service is backed by Redis for token revocation.
- *"Who do I escalate a Stripe outage to?"*
  → Dana Whitfield (Payments team lead), post in `#billing-incidents`, page PagerDuty service `northwind-billing`.

**The point to land:** these facts came from separate PDFs + a Markdown file, and the agent gets a *structured, cross-referenced* answer with the source text as evidence — not a blind vector-snippet dump.

### Step 6 (optional) — Show it getting smarter
Tell Claude Code: *"Contribute this learning to the graph: the Dunning Worker also posts to #billing-alerts after the final retry."* It calls `context_contribute`. Ask the billing question again — the new fact is merged in, and re-stated facts reinforce (bump confidence) rather than duplicate.

### Fallback (no MCP client handy) — same thing via CLI
```bash
context-graph --db ./northwind-demo.db ingest-dir examples/demo-docs
context-graph --db ./northwind-demo.db export --out northwind-graph.html && open northwind-graph.html
context-graph --db ./northwind-demo.db query "how are failed charges retried?"
```
(Delete `northwind-demo.db*` to reset.)

---

## 5. Talking points (what to say while it runs)

- **"It's a graph, not a bag of chunks."** A vector store gives you similar snippets. This gives an agent *structure* it can reason over — what things are, and how they connect — plus the source passages as evidence.
- **"Agents write back."** Most RAG is read-only. Here an agent contributes a learning and it's merged into shared knowledge with provenance, so the next agent benefits.
- **"It compounds."** Confidence + observation counts mean the tenth confirmation of a fact strengthens it; one-off noise stays low-confidence. The graph curates itself.
- **"Zero infrastructure, one command."** Embedded SQLite, in-process embeddings, `curl | sh`. No database to stand up, no keys required to start. Cloud is an *upgrade*, not a requirement.
- **"TypeScript & MCP-native."** Most comparable OSS (Graphiti, GraphRAG, Cognee, mem0) is Python and/or server/cloud-oriented. This slots directly into a JS/TS agent stack and speaks MCP out of the box.

---

## 6. Repository & install

Published to **`github.com/NanoNets/context-graph-engine`** (private, branch `main`).

```bash
git clone git@github.com:NanoNets/context-graph-engine.git
cd context-graph-engine && ./install.sh   # build + link the local checkout
```

> ⚠️ The `curl … | sh` one-liner in the README fetches `install.sh` over an
> anonymous URL, which only works once the repo is **public** (or with a token).
> While the repo is private, use the clone + `./install.sh` path above. Flip the
> repo to public when you're ready and the curl one-liner goes live as-is.

---

## 7. Where to look in the code

```
src/
  engine.ts            ← start here: ingest / read / contribute, provider selection
  ai/
    providers.ts       ← config resolution (constructor → env → defaults) + interfaces
    local.ts           ← key-free LocalEmbedder + OllamaExtractor
    openrouter.ts      ← cloud extraction via OpenRouter (tool-calling)
    openai.ts          ← OpenAI embeddings (optional)
  graph/
    types.ts           ← the data model (nodes, edges, chunks) — read this to grok the domain
    merge.ts           ← dedup + reinforcement (the "gets smarter" logic)
    sqlite-store.ts    ← the embedded storage backend
    export.ts          ← graph → interactive HTML / JSON / Mermaid
  ingest/
    chunker.ts         ← paragraph-aware chunking with overlap
    pdf.ts             ← PDF → text extraction (unpdf)
  retrieval/retriever.ts ← semantic match + one-hop expansion + prompt rendering
  cli.ts               ← the CLI (ingest / ingest-dir / query / contribute / export / stats)
  mcp.ts               ← the MCP server (7 tools incl. _ingest_dir and _export)
examples/
  quickstart.ts        ← library quickstart
  demo-docs/*.pdf      ← the 3 demo PDFs used in §4
scripts/make-demo-pdfs.mjs ← regenerates the demo PDFs
```
