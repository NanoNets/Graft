# Context Graph Engine — Product Spec & GTM Strategy

> **Internal only — gitignored.** Working draft for management review.
> Companion docs: `BUSINESS-CASE.md` (why this idea), `PRODUCT-DESIGNS.md` (design sketches).
> Last updated: 2026-07-09

---

## 1. One-paragraph summary (the elevator answer)

A self-hosted engine that turns a team's documents into a living knowledge graph that AI agents read before doing work and write learnings back to — so context compounds instead of being re-discovered every session. Bring your own LLM API key (OpenRouter/OpenAI) for high-quality extraction; everything else — the graph, embeddings, retrieval — runs on your own machine, and a fully local mode (Ollama) exists for teams that can't send data to a cloud model. Plugs into any agent via MCP.

**Positioning note:** the recommended path is API-key-first (quality), with local models as the privacy/air-gapped fallback — not the other way around.

## 2. Problem & who has it

**The agent problem (primary, why now):** an AI agent session starts from zero. Claude Code / Cursor re-discovers the same architecture, conventions, and gotchas on every task — burning tokens and latency re-reading files — and throws the learning away when the session ends. Vector RAG gives agents a bag of chunks, not structure they can reason over, and no write path to contribute learnings back.

**The staleness problem (why existing fixes fail):** any knowledge base built once is wrong within days. Repos and folders change daily; nobody re-runs ingestion. The harder problem than indexing is *keeping the index alive*: knowing when a file change actually warrants re-extraction, pruning facts that no longer hold, and doing it in the background without anyone babysitting it.

**Our scope (v1):** local repos and folders — the material closest to where agents work and where changes are detectable. Connectors to Slack, Notion, Drive etc. are a later addition, not v1. Users can also explicitly add files/facts via the web UI to a team or personal graph.

**The payoff:** agents get a compact, fresh context bundle instead of re-exploring , lower latency, fewer tokens per task; humans get a readable, citable map of their own repos and folders.

**Who feels it most:** teams (and individuals) using coding agents daily on real codebases, who prefer self-hosted tooling and won't ship their source to a vendor's cloud index.

## 3. What the product is (spec)

### 3.1 Core capabilities

The engine is a loop, not a one-shot indexer:

1. **Ingest** — point it at repos and folders (plus drag-and-drop of individual files in the web UI). Prose is chunked and extracted into entities + typed relationships, grounded in source passages. Code repos go through a per-file summarization pass first, then extraction over the summaries.
2. **Stay fresh (the differentiator)** — watched folders and repos keep syncing into the graph through background processes. The engine decides *when* a file change actually warrants re-extraction (not every save does), *what* to update incrementally, and *what to prune* — facts whose source files were deleted or contradicted decay and drop out. Nobody babysits the index; the graph is as current as the filesystem.
3. **Read** — an agent (or human) queries before a task and gets a compact context bundle: relevant entities, relationships, and cited source passages, sized to drop into a prompt. Reading the bundle instead of re-exploring the repo is where the latency and token savings come from.
4. **Contribute** — agents and humans write learnings back. New facts are deduplicated against existing knowledge; repeated observations reinforce confidence instead of duplicating. Every fact carries a provenance receipt: observation count, confidence, sources.

### 3.2 Surfaces

- **Graph-as-files (zero-dependency surface)** — the graph materializes *into the tracked repo/folder itself*, in a format and location the user picks per repo: a single compact `CONTEXT.md`, a directory of interlinked markdown files (one per entity/module), or machine-readable JSONL; committed or gitignored. Any agent can read it natively — no MCP call, no server running — and it's grep-able, git-versioned, and PR-reviewable. Agents can even contribute back by writing to a designated learnings file that the watcher ingests. The background sync keeps these files current; the graph database remains the source of truth.
- **MCP server** — the richer agent surface for targeted queries: compact context bundles sized for a prompt, plus structured contribute. Works with Claude Code, Cursor, and anything MCP-speaking, including Claude Code hooks and PR ingestion.
- **Web UI** — the human surface: drop files, browse a readable map of your repos and folders, ask cited questions, add facts by hand to a team or personal graph.
- **CLI & library** — for scripting and embedding in other tools.
- **Team sync** — a git-native graph file (merge-safe under concurrent edits) or a shared Docker deployment at one URL.

### 3.3 What we optimize for

- **Freshness** — the graph tracks the filesystem without human effort; stale facts get pruned, not accumulated.
- **Latency & token savings** — a task that costs an agent minutes of cold file exploration costs one graph read instead: on a real 344-file repo, benchmarks showed 31% fewer tool calls, −23% cost, and −17% latency. Measured, not promised — see `bench/`.
- **Human readability** — the graph doubles as living documentation: a new teammate can browse it and understand a repo's structure, owners, and gotchas.

### 3.4 Explicitly out of scope for v1

- Cloud connectors (Slack, Notion, Drive) — local repos and folders first; connectors come later.
- Hosted/SaaS offering — self-hosted only for now.
- Fine-grained access control within a graph — a graph is shared wholesale or personal.

## 4. Target users & ICP

**1. The individual power-user of coding agents (beachhead).** A developer running Claude Code / Cursor daily on a handful of repos. They already maintain a CLAUDE.md by hand and feel it decaying; they want their agent to stop re-exploring the same codebase every session. Zero-friction adoption: one install, point at a repo, no team buy-in needed. Value lands in the first session.

**2. Teams of 5–50 engineers using agents on a shared codebase.** The individual's graph becomes the team's when it's committed to the repo or served from one Docker URL. The motion: one champion adopts, the committed `.context/` files make it visible to everyone who clones, teammates onboard by browsing the graph. This is where shared agent memory and human-readable living documentation compound.

**3. Knowledge-heavy teams and individuals beyond code.** Folders of PDFs, notes, research, runbooks, contracts — the same engine, pointed at documents instead of repos: watched folders stay fresh, answers come back cited, and the graph is a browsable map of what the team knows. Same self-hosted, local-first appeal (r/selfhosted, HN crowd) for people who won't ship their documents to a vendor's cloud.

All three run on the same product — no separate editions. The segments differ only in what they point the engine at.

## 5. Positioning & competition

**One-liner:** *the self-maintaining context graph for your repos and folders — agents read it, write back to it, and it never goes stale.*

How we differ, by neighbor:

- **Context files (CLAUDE.md, AGENTS.md, .cursor/rules)** — today's default, generated and appended to by agents themselves. But nothing *manages* them: no change detection when the codebase moves underneath, no dedup or pruning (they bloat and drift), no provenance on any line, and the whole flat file is loaded every session regardless of the task. We are the management layer this pattern is missing — a structured graph behind it that stays fresh, with the context file as one generated, always-current output rather than an append-only scratchpad.
- **Vector RAG stacks (LlamaIndex-style pipelines, codebase embeddings in Cursor)** — retrieval over chunks. No structure to reason over, no relationships, no confidence/provenance, no contribute path, and re-indexing is on you. We're a graph with typed relationships and a reinforcement loop, kept fresh automatically.
- **Agent memory layers (mem0, Zep, Letta)** — memory of *conversations*, usually cloud-hosted, per-agent. We're memory of *your filesystem and codebase*, self-hosted, shared across every agent and human on the team. Complementary more than competitive.
- **GraphRAG (Microsoft) and knowledge-graph research tools** — batch, one-shot, expensive to rebuild, no freshness story. Our whole thesis is the maintenance loop they lack.
- **Enterprise search (Glean)** — per-seat SaaS, connector catalog, your documents in their cloud. We're self-hosted, free to start, repos-and-folders first. When we're compared to Glean, the answer is: different buyer, different trust model.

**The moat we're building:** not extraction (everyone has an LLM) — the *maintenance intelligence*: knowing when to update, what to prune, and how confidence should evolve. That's accumulated product logic, and the graph itself compounds — the longer a team runs it, the more contributed learnings it holds that exist nowhere else.

## 6. Open source strategy & licensing

**Yes — the engine is open source, MIT-licensed, deliberately.**

**Why OSS is the distribution strategy:** our target users (agent power-users, self-hosters) adopt from GitHub, HN, and word-of-mouth, and they specifically distrust closed tools that touch their source code. Open source is what earns the "your data never leaves your machine" claim credibility — anyone can verify it. It's also how a two-person project gets a connector/integration ecosystem it could never build alone.

**The open-core line (when monetization starts):** the engine — ingest, freshness loop, graph, MCP, web UI, CLI — stays MIT forever; that's the promise that makes adoption safe. What can be proprietary later: the **hosted cloud version** (we run it for you), and **team/enterprise features** around the core (auth, roles, SSO, audit, central admin). This is the standard open-core playbook (GitLab, Supabase, PostHog) and it doesn't require relicensing anything we shipped.

## 7. Teams & multi-user support

_Current state (Docker single-URL sharing, git-native graph sync), what real "teams" means — auth, roles, permissions, hosted option — and when we'd build it. TODO._

## 8. Release plan & milestones

**Phase 0 — Harden the wedge.** Ship the things the pitch depends on: pruning/decay so the freshness claim is fully true, graph-as-files output, and a token/latency benchmark on 2–3 real repos. Exit criterion: a stranger can install, point at a repo, and get value in under 5 minutes without us in the room.

**Phase 1 — Private alpha.** 10–20 hand-picked internal Nanonets users from segment 1 (coding-agent power-users). Goal is watching where onboarding breaks and whether people *keep* the watcher running after week one. Exit criterion: users still active after 10 days without prompting.

**Phase 2 — Public OSS launch.** "Released" means: public repo, one-line install, docs good enough that issues are feature requests rather than confusion. Plan in §8.1.

**Phase 3 — Team features.** Driven by what alpha/launch users actually ask for.

### 8.1 Public launch plan

**Assets:** README with a demo GIF + benchmark table, 2-min demo video, launch blog post, tested 5-min quickstart.

**Channels:**
- **Show HN** — *"Show HN: A context graph for your repos that AI agents read and keep fresh"*
- **MCP directories** — official registry, Smithery, PulseMCP, mcp.so, Glama. Targeted, compounds over time.
- **Awesome lists** — awesome-mcp-servers, awesome-selfhosted, awesome-claude-code.
- **Reddit** — r/selfhosted, r/LocalLLaMA, r/ClaudeAI, r/cursor — each with its own angle.
- **Communities & creators** — Claude Code/Cursor/MCP Discords, TLDR/Console.dev newsletters, a few agent-tooling YouTubers.

## 9. Business model & monetization path

_Free OSS core → what we could charge for (hosted, team/enterprise features, support). When monetization becomes relevant. TODO._

## 10. Metrics & what winning looks like

_Stars/installs/weekly active graphs, contribution-loop engagement, and the 6-month success criteria. TODO._

## 11. Risks & open questions

_Honest list: adoption risk, moat, model-cost dependency, and questions we want management input on. TODO._
