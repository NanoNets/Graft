# Context Graph Engine

**31% fewer tool calls, 23% less cost, 17% lower latency.** That's what your agent gets from reading the repo's context graph before it starts working.

The graph is a folder of plain markdown files in the repo — one per system, API, or concept, linked to each other. It stays in sync with the code through git, so anyone who clones the repo has it, no setup.

## How it works

- Edit code, regenerate the graph, commit both together.
- Someone clones the repo — they've got the graph, nothing to set up.
- Their agent reads it before doing work.

No database, no server, no embeddings. The graph is just files in git, so git is the sync. And when a change moves something around, you see it in the graph diff right next to the code, in the same PR.

## Setup

```bash
# in your repo
context-graph init          # builds .context/ from your code
git add .context && git commit

# keep it honest — fails CI if the graph is stale
context-graph check
```

That's it. Anyone who clones the repo gets `.context/` for free. Point your agent at it and it reads the graph before working.

## The proof

Same model, same tools, same tasks. The only difference is whether the agent got the graph first. On a real 344-file repo it cut tool calls 31%, cost 23%, and latency 17%. The graph isn't magic — it's just that reading a few linked files beats rediscovering the codebase from scratch every single time.

## Runs locally

Everything runs on your machine. No accounts, no cloud calls, no keys. Building the graph uses a local model (Ollama); if you'd rather use a cloud model for better summaries, set a key and it'll use it. Local stays the default.
