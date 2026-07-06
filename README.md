# Context Graph Engine

> Turn any docs into a structured **context graph** that AI agents read from before doing work — and contribute their learnings back to, so the graph gets smarter every time it's used.

Dumping docs into a vector store gives you a bag of chunks. It doesn't give you *structure* an agent can reason over, and there's no clean way for an agent to send back what it learned mid-task. The Context Graph Engine fixes both:

- **Ingest** any docs → a graph of **entities** (concepts, systems, people, APIs…) connected by typed **relationships**, grounded in the original source passages.
- **Read** the graph before a task → get a compact, structured context bundle (entities + relationships + supporting sources), ready to drop into a prompt.
- **Contribute** learnings back → new facts are deduplicated and merged into existing knowledge; repeated observations **reinforce** confidence. The graph compounds over time.

Access it four ways: a **web UI** (your team's knowledge as a living, citable graph — see below), a **library**, a **CLI**, or an **MCP server** that any agent (Claude Code, Cursor, …) can plug into.

---

## Install

**One line, runs locally, no API keys required:**

```bash
curl -fsSL https://raw.githubusercontent.com/NanoNets/context-graph-engine/main/install.sh | sh
```

This puts `context-graph`, `context-graph-mcp`, and `context-graph-web` on your PATH. Requires git and Node ≥ 20.

Or straight from GitHub with npm:

```bash
npm install -g github:NanoNets/context-graph-engine
```

Or as a library / dev dependency:

```bash
npm install context-graph-engine
```

## Try it in 60 seconds — the web UI

```bash
context-graph-web
# → http://localhost:4680
```

Open the page, point **“Ingest a folder of documents”** at any folder of `.pdf` / `.md` / `.txt` files, and watch it become a knowledge graph. Then ask questions: answers come back with numbered citations, and every fact wears a **provenance receipt** — how many times it's been observed, how confident the graph is, and which sources say so. Use **“Teach it something”** to add a fact the docs don't capture, and watch the graph reinforce in real time.

Everything runs on your machine (the server binds to localhost only). Set `OPENROUTER_API_KEY` to upgrade to LLM-written answers and cloud extraction; without it, retrieval and the graph stay fully local.

### Runs locally by default — keys are optional

Out of the box the engine needs **no accounts and no cloud calls**:

- **Embeddings** run **in-process** via a small ONNX model (transformers.js) — downloaded and cached on first use.
- **Extraction** uses a local **[Ollama](https://ollama.com)** model. Install Ollama and pull one:
  ```bash
  ollama pull llama3.2
  ```

Want higher-quality cloud models instead? Set a key and the engine uses it **automatically** (local remains the fallback):

```bash
export OPENROUTER_API_KEY=sk-or-...   # cloud extraction via OpenRouter
export OPENAI_API_KEY=sk-...          # cloud embeddings (optional; local otherwise)
```

Force local even when keys are present with `CONTEXT_GRAPH_LOCAL=1`.

---

## Quickstart (library)

```ts
import { ContextGraphEngine } from "context-graph-engine";

const engine = new ContextGraphEngine(); // persists to ./.context-graph/graph.db

// 1. Ingest docs — builds the graph.
await engine.ingest(myMarkdownDocs, { title: "Onboarding" });
await engine.ingestFile("./docs/architecture.md");

// 2. Read before doing work.
const ctx = await engine.read("how does authentication work?");
console.log(ctx.prompt);   // inject this string into your agent
console.log(ctx.nodes);    // structured entities
console.log(ctx.edges);    // structured relationships

// 3. Contribute what an agent learned.
await engine.contribute(
  "The auth service rotates tokens every 15 minutes.",
  { agentId: "code-reviewer" },
);
```

Run the full working demo (set `OPENROUTER_API_KEY`, or run a local Ollama):

```bash
npm run example
```

---

## CLI

```bash
# Ingest documents (Markdown, text, and PDFs — PDFs are parsed automatically)
context-graph ingest ./docs/*.md ./handbook.pdf
context-graph ingest-dir ./docs           # a whole folder, recursively
echo "some notes" | context-graph ingest-text --title "Notes"

# Visualize the graph (interactive HTML; also --format json|mermaid)
context-graph export --out graph.html && open graph.html

# Read the graph
context-graph query "how does billing retry failed charges?"
context-graph query "billing" --json          # full structured bundle

# Contribute a learning
context-graph contribute "Dunning worker retries 3x then marks past_due" --agent me

# Inspect
context-graph stats

# Point at a specific graph file
context-graph --db ./team-graph.db query "auth"
```

---

## MCP server

Expose the graph to any MCP client so agents can `context_read` and `context_contribute` directly — the same "shared skill / durable memory" model as tools like ByteRover.

Add to your Claude Code / MCP client config:

```json
{
  "mcpServers": {
    "context-graph": {
      "command": "context-graph-mcp",
      "env": {
        "CONTEXT_GRAPH_DB": "/absolute/path/to/team-graph.db"
      }
    }
  }
}
```

The API-key env vars are optional — add `OPENROUTER_API_KEY` (and optionally `OPENAI_API_KEY` for embeddings) only if you want cloud models instead of the local defaults.

Tools exposed:

| Tool | What it does |
|------|--------------|
| `context_read` | Read relevant context for a query before working |
| `context_contribute` | Write a learning back into the shared graph |
| `context_ingest` | Ingest a document (raw text) into the graph |
| `context_ingest_file` | Ingest files from disk, including **PDFs** (parsed automatically) |
| `context_ingest_dir` | Ingest a whole **directory** of docs (PDF/MD/TXT), recursively |
| `context_export` | Write the graph to an interactive **HTML** visualization |
| `context_stats` | Report how much the graph currently holds |

A natural agent workflow: **read context → do the task → contribute what you learned.**

---

## How the graph gets smarter over time

Every entity and relationship carries a `confidence` score and an `observations` count.

- **Dedup on write.** When new knowledge comes in, each entity is matched against existing nodes by exact name/alias **and** embedding similarity (cosine ≥ `mergeThreshold`). A match is *merged*, not duplicated.
- **Reinforcement.** Each re-observation increments `observations` and nudges `confidence` toward 1.0. Facts seen across many docs/agents rise to the top; one-off mentions stay low-confidence.
- **Provenance.** Every node/edge tracks which documents and agents contributed to it.
- **Grounding.** Source passages are kept as retrievable evidence and returned alongside the structured graph.

This is what makes contributions compound: the tenth agent to confirm a fact strengthens it rather than cluttering the graph.

---

## How it works

```
        ingest / contribute                         read
   ┌──────────────────────────┐            ┌────────────────────────┐
   │ text → chunk → embed      │            │ query → embed           │
   │      → extract (LLM)      │            │  → semantic match nodes │
   │      → MERGE (dedup +     │───────────▶│  → expand 1 hop (edges) │
   │        reinforce)         │  graph     │  → gather source chunks │
   └──────────────────────────┘  (SQLite)  │  → render context bundle│
                                            └────────────────────────┘
```

- **Storage** — SQLite (via `better-sqlite3`) by default; swap in your own `GraphStore`.
- **Extraction** — local **Ollama** (`llama3.2` by default) using structured JSON output; automatically upgrades to **OpenRouter** (`openai/gpt-4o-mini` by default, any tool-calling model) if `OPENROUTER_API_KEY` is set.
- **Embeddings** — local **in-process** model (`Xenova/all-MiniLM-L6-v2`, 384-dim) by default; automatically upgrades to **OpenAI** (`text-embedding-3-small`) if `OPENAI_API_KEY` is set.
- **Retrieval** — semantic match over entities + one-hop graph expansion + supporting source passages.

> Note: embeddings from different models aren't comparable, so pick local **or** cloud for a given database and stick with it — don't switch providers mid-graph.

---

## Configuration

Everything is configurable via constructor options, environment variables, or defaults (in that order):

```ts
new ContextGraphEngine({
  dbPath: "./.context-graph/graph.db",          // CONTEXT_GRAPH_DB
  // Cloud (used automatically when set):
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  openrouterModel: "openai/gpt-4o-mini",         // CONTEXT_GRAPH_OPENROUTER_MODEL
  openaiApiKey: process.env.OPENAI_API_KEY,      // optional, embeddings only
  embeddingModel: "text-embedding-3-small",      // CONTEXT_GRAPH_EMBEDDING_MODEL
  // Local (the zero-key fallback):
  forceLocal: false,                             // CONTEXT_GRAPH_LOCAL=1 forces local
  localEmbeddingModel: "Xenova/all-MiniLM-L6-v2",// CONTEXT_GRAPH_LOCAL_EMBEDDING_MODEL
  ollamaModel: "llama3.2",                       // CONTEXT_GRAPH_OLLAMA_MODEL
  ollamaBaseUrl: "http://localhost:11434",       // CONTEXT_GRAPH_OLLAMA_URL
  chunkSize: 1200,
  chunkOverlap: 200,
  mergeThreshold: 0.86,   // higher = stricter dedup
});
```

### Bring your own components

The engine depends only on small interfaces, so you can replace any piece:

```ts
import { ContextGraphEngine, type Embedder, type Extractor, type GraphStore } from "context-graph-engine";

new ContextGraphEngine({
  store: myCustomStore,        // e.g. Postgres/pgvector
  embedder: myCustomEmbedder,  // any embedding model
  extractor: myCustomExtractor // any LLM, or a rules-based extractor
});
```

This is exactly how the test suite runs the whole pipeline offline with fake providers.

---

## API reference (essentials)

```ts
class ContextGraphEngine {
  ingest(text: string, opts?: { title?; source? }): Promise<IngestResult>;
  ingestFile(path: string, opts?): Promise<IngestResult>;   // .pdf parsed automatically
  ingestDir(dir: string, opts?): Promise<IngestResult[]>;   // recursive; PDF/MD/TXT
  read(query: string, opts?: { maxNodes?; maxChunks?; expand? }): Promise<ContextBundle>;
  contribute(learning: string, opts?: { agentId?; source? }): Promise<ContributeResult>;
  exportGraph(): GraphExport;                               // -> toHtml / toMermaid
  stats(): GraphStats;
  close(): void;
}
```

A `ContextBundle` contains `{ query, nodes, edges, chunks, prompt }` — use `prompt` for a ready-made context block, or the structured arrays to build your own.

---

## Development

```bash
npm install
npm run build      # compile to dist/
npm run cli -- stats     # run the CLI from source
npm run mcp              # run the MCP server from source
```

## License

MIT
