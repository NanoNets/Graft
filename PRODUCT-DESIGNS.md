# Context Graph Engine — Design Sketches for the Top 5 Product Ideas

> **Purpose:** design sketches for the five candidate products, written to a
> common template so they can be reviewed and scored side by side. Grounded in
> the current codebase (`src/engine.ts`, `src/graph/*`, `src/ai/*`, `src/mcp.ts`).
>
> **Frame (decided):** standalone, open-source, local-first, download-and-run,
> aimed at **small teams / companies**, **pure OSS / grow-first**.
>
> **Reviewer:** each idea uses the same 11 headings. Section 0 describes the
> shared primitives (team sync, scoping, embedding consistency) that most ideas
> depend on — read it first, it's referenced throughout.

---

## What already exists (the substrate)

The engine is real and most of a product already:

- **Core API** (`ContextGraphEngine`): `ingest` / `ingestFile` / `ingestDir` / `read` / `contribute` / `exportGraph` / `stats`.
- **Data model** (`graph/types.ts`): `GraphNode` and `GraphEdge` each carry `confidence`, `observations`, `provenance[]`, timestamps; `Chunk`s ground them in source text.
- **Merge/reinforce** (`graph/merge.ts`): incoming entities are matched to existing nodes by exact normalized name/alias **and** embedding cosine ≥ `mergeThreshold`; matches reinforce (`observations += 1`, confidence → 1, provenance union), non-matches are created. Edges dedupe on `(source, target, relation)`.
- **Storage** (`graph/store.ts` → `SqliteStore`): the engine talks to a **`GraphStore` interface**, so the backend is swappable (this is the single most important fact for the team ideas).
- **Providers** (`ai/*`): local-first — in-process embeddings (transformers.js `all-MiniLM-L6-v2`, 384-dim) + Ollama extraction; auto-upgrades to OpenRouter/OpenAI when keys are present.
- **Access modes**: library, `context-graph` CLI, `context-graph-mcp` MCP server (7 tools).
- **Retrieval** (`retrieval/retriever.ts`): semantic match on nodes → one-hop expansion → supporting chunks → rendered prompt.
- **Export** (`graph/export.ts`): interactive HTML / JSON / Mermaid.

### Known gaps every idea must reckon with

1. **Single graph per DB.** No namespaces/collections — one `.db` file = one graph. Multi-project scoping = separate DB files today, or a new `scope` column.
2. **No team sync.** The graph is local to one machine. → **Section 0.1**.
3. **Embedding provider must be consistent across a shared graph.** Vectors from different models aren't comparable; dedup/retrieval break if two members use different embedders. → **Section 0.3**.
4. **In-memory vector search.** `allEmbeddedNodes()` loads all nodes to score. Fine for small-team scale (thousands of nodes); a ceiling to note, not fix now.
5. **No delete / decay / temporal.** Facts don't expire or track "when true." Deferred features; matters for some ideas more than others.
6. **No auth / access control.** Acceptable for local single-user; needs a story the moment a graph is shared over a network.

---

## Section 0 — Shared primitives (referenced by ideas 1–4)

### 0.1 Team sync — the one real new engineering task

Most ideas reduce to "the same engine, but the graph is shared across a small
team." Two modes, both leaning on the existing `GraphStore` interface and the
fact that **merge is near-idempotent** (re-applying a contribution reinforces
rather than corrupts).

**Mode A — Git-native (zero infra, best for coding teams).**
- Serialize the graph to a committed, human-diffable file: `.context-graph/graph.jsonl` (one node/edge/chunk per line) or a small directory of shards to reduce merge churn.
- `pull` → import + **re-merge** remote records into the local graph using the *existing* `mergeExtraction`-style union (dedup by name/embedding, reinforce, union provenance). Because merge is commutative-ish, two people's additions combine without a central server.
- `push` → re-serialize and commit. Conflicts resolve by union, not overwrite (take max `observations`, reinforced `confidence`, union `provenance`, newer `updatedAt` for `summary`).
- Pros: zero infra, versioned, offline-friendly, code never leaves the repo. Cons: not real-time; embeddings bloat the file (store quantized or recompute on import).

**Mode B — Shared store (near-real-time, best for non-code teams).**
- Implement `GraphStore` against a shared backend. Recommended: **libSQL / Turso embedded replica** — a local SQLite file that syncs to a shared remote. This preserves *local-first* (reads/writes hit local) while giving *team-shared* state. Alternative: `PostgresStore` (+ pgvector) for a self-hosted server.
- Pros: real-time, scales past git-file limits. Cons: someone runs the sync target (a Turso DB or a Postgres container).

**Recommendation:** ship **Mode A first** (it's the differentiator and needs no infra), offer **Mode B** as an opt-in for larger/non-code teams. Both are additive — the engine core is untouched.

### 0.2 Scoping / namespaces

Teams have multiple projects. Minimal design: add an optional `scope` (a.k.a.
`collection`) string to documents/nodes/edges, default `"default"`, filterable
at read time. Cheaper interim: one DB file per project (already supported via
`--db` / `CONTEXT_GRAPH_DB`). Recommend interim for v1, `scope` column when a
single shared store hosts many projects (Mode B).

### 0.3 Embedding consistency (a hard constraint, not a nice-to-have)

A shared graph **must** pin one embedding model for all members, recorded in
graph metadata; the engine should refuse (or warn + re-embed) on mismatch. For
local-first teams, standardize on the in-process `all-MiniLM-L6-v2` so there are
no keys and no drift. Cloud embeddings become a per-graph, all-or-nothing choice.

### 0.4 Provenance & trust (already have the bones)

`provenance[]` + `observations` + `confidence` already exist per node/edge. Every
idea should surface these in its UX (who/what contributed a fact, how many times
confirmed) — it's the built-in trust and "gets smarter" story.

---

## Idea 1 — Shared memory for a team's coding agents  ⭐ recommended beachhead

**1. Positioning.** One self-hosted graph every developer's Claude Code / Cursor
reads before working and writes learnings back to — so the team's agents stop
re-learning the codebase, conventions, and the reasons behind past decisions.

**2. Target user & JTBD.** Small eng teams (2–20). *"My AI agent doesn't know how
**we** do things, so I re-explain our patterns every session and it repeats
mistakes we already solved."*

**3. Primary flows.**
- *Bootstrap:* `context-graph ingest-dir ./` over the repo + docs → initial graph committed to `.context-graph/`.
- *Before work (automatic):* agent calls `context_read` via MCP → gets conventions, gotchas, ownership, past decisions relevant to the task, with source lines.
- *After work (automatic):* agent calls `context_contribute` with what it learned ("the retry helper lives in `net/backoff.ts`, not `util`"); merged + reinforced.
- *Sync:* `git pull` merges teammates' contributions (Mode A); the graph rides the repo.

**4. Architecture.** Reuses the engine wholesale. New: **Team Sync Mode A**
(§0.1), a `context-graph sync` command + a git hook / CI step, and MCP tool
polish. Optional: a "session recap" that batches an agent's session into one
contribution.

**5. Data model changes.** Add a `kind`/`type` vocabulary for code entities
(`module`, `function`, `convention`, `decision`, `pitfall`, `owner`). Add
`scope` = repo path if multi-repo (§0.2). Serialization format for git sync.

**6. Hero feature.** **Write-back that survives `git pull`** — the graph is
shared, versioned, and compounds across the whole team, and it visibly improves
(confidence/observation counts) as everyone's agents use it.

**7. MVP scope.**
- *In:* repo ingest, MCP read/contribute (exists), Mode A git sync, code-aware entity types, a `sync`/merge command, README quickstart, the HTML graph view.
- *Out:* web UI, real-time sync, access control, decay.

**8. Effort.** **Low–Med.** The engine + MCP exist; the real work is sync + serialization + code-entity tuning. ~2–3 weeks to a launchable v1.

**9. Distribution / GTM.** MCP directory listing, Show HN, `curl | sh`, a README
demo GIF of the graph. Coding-agent devs are the most OSS-viral audience in 2026.
Dogfood on this very repo (it's already an MCP server).

**10. Success metrics.** GitHub stars, MCP installs, weekly-active graphs,
**contributions-back per active graph per week** (the "is it compounding?" metric),
% of teams with >1 contributor to a graph.

**11. Risks / open questions for the reviewer.**
- Does git-file sync stay clean once embeddings are in the file? (Quantize? Recompute on import? Separate embedding cache out of git?)
- Contribution quality/noise: do we need a confidence floor or a review gate before a learning becomes readable?
- Is "one graph per repo" the right unit, or per-monorepo-package?
- Overlap with ByteRover — is "team-shared + reinforcing" a strong enough wedge vs their individual file-tree?

---

## Idea 2 — Self-hosted "team brain" (the small-team Glean, but OSS)

**1. Positioning.** Point it at a team's docs (Notion/Drive export, PDFs,
markdown) → a self-improving knowledge graph both people and agents query, via a
web UI to explore/ask and an MCP server so any agent taps in.

**2. Target user & JTBD.** Small companies (10–100) where knowledge is scattered
and Glean/Guru are too pricey/enterprise. *"Nobody can find the current answer,
and the wiki is stale."*

**3. Primary flows.**
- *Ingest:* connect a source or drop a folder → graph builds (progress UI).
- *Ask (human):* web search box → structured answer + source passages + a graph view of related entities.
- *Ask (agent):* MCP `context_read`.
- *Curate:* the graph self-reinforces; humans can confirm/flag a fact (bumps/curbs confidence).

**4. Architecture.** Engine + **a new web app** (the big lift) + **Mode B shared
store** (§0.1) so multiple users hit one graph + **connectors** (start with
folder + Notion/Drive export). Auth needed once networked (§0 gap 6).

**5. Data model changes.** `scope`/workspace column (§0.2); user identity for
contributions; a `verified`/`flagged` state on nodes/edges layered over
confidence; source-connector metadata on documents.

**6. Hero feature.** **A living knowledge base that doesn't rot** — write-back +
reinforcement keep it current, and humans + agents share exactly one source of
truth, with the graph as a navigable map.

**7. MVP scope.**
- *In:* folder + one connector, Mode B store, web UI (search + answer + graph view + admin), basic auth, MCP read.
- *Out:* fine-grained permissions, SSO, real-time collab, mobile.

**8. Effort.** **Med–High.** The web UI + connectors + auth are net-new and are
the bulk of the work. ~6–10 weeks to a credible v1.

**9. Distribution / GTM.** Self-host via Docker; OSS repo; "the open, local Glean"
narrative. Slower-burning than Idea 1 (not developer-viral by default).

**10. Success metrics.** Deployed instances, weekly-active askers, queries/week,
answer thumbs-up rate, fraction of answers with a cited source.

**11. Risks / open questions.**
- Scope creep: this competes with mature tools; UI quality bar is high.
- Retrieval quality on heterogeneous docs — is one-hop + chunks enough, or do we need multi-hop / reranking?
- In-memory vector search ceiling (§0 gap 4) arrives sooner here.
- This is the **natural expansion of Idea 1**, not a cold start — is it premature to build before Idea 1 shows pull?

---

## Idea 3 — Onboarding & tribal-knowledge brain (+ Slack bot)

**1. Positioning.** Capture how your systems work, who owns what, and the answers
that clog Slack — into a graph a bot answers from and learns from every thread.

**2. Target user & JTBD.** Small teams with painful new-hire ramp and
repeated questions. *"We answer the same onboarding questions every week."*

**3. Primary flows.**
- *Seed:* ingest onboarding docs, runbooks, an org/ownership sheet.
- *Ask:* `@brain how do we deploy staging?` in Slack → answer + sources.
- *Learn:* the bot ingests resolved threads (opt-in) via `contribute`, so answered questions strengthen the graph.
- *Escalate:* if confidence is low, route to the owner entity in the graph.

**4. Architecture.** Engine + **a Slack app** (events API, slash command, thread
reader) + Mode B store (bot is a shared service). Reuses read/contribute directly.

**5. Data model changes.** `owner`/`team` entity types + `owns`/`escalates_to`
relations; thread/message provenance; confidence threshold config for
"answer vs escalate."

**6. Hero feature.** **The contribute/reinforce loop is a perfect fit** — every
answered question makes the next answer better; low-confidence gaps auto-route to
a human owner.

**7. MVP scope.**
- *In:* Slack bot (Q&A + thread ingest), doc ingest, owner/escalation entities, confidence-gated escalation.
- *Out:* other chat platforms, analytics dashboard, auto-summarized weekly digests.

**8. Effort.** **Med.** Self-contained; the Slack integration is the main new
surface. ~4–6 weeks.

**9. Distribution / GTM.** Slack App Directory + OSS self-host. Narrow, concrete,
easy to explain; less developer-viral than Idea 1.

**10. Success metrics.** Questions answered/week, % answered without escalation,
median time-to-answer, new-hire "time to first useful answer," contributions from
resolved threads.

**11. Risks / open questions.**
- Answer quality/hallucination on thin graphs — need a hard confidence floor + "I don't know, ask @owner."
- Privacy: ingesting Slack threads needs clear opt-in and redaction.
- Is a Slack bot the right first surface, or a thinner CLI/MCP bot to validate value faster?

---

## Idea 4 — Support graph that learns from resolved tickets

**1. Positioning.** A graph over help docs + resolved tickets; an agent drafts
answers and every resolution reinforces what's actually true — support that
compounds.

**2. Target user & JTBD.** Small support/CS teams. *"We keep re-solving the same
issues; our macros and docs drift from reality."*

**3. Primary flows.**
- *Seed:* ingest help center + historical resolved tickets.
- *Draft:* on a new ticket, `read` → agent drafts a grounded reply with sources.
- *Learn:* on resolution, `contribute` the accepted answer → reinforces the graph.
- *Surface gaps:* low-confidence/frequent-miss topics flagged for a doc update.

**4. Architecture.** Engine + **helpdesk connectors** (Zendesk/Intercom/email) +
an answer-draft flow + Mode B store. Reuses read/contribute.

**5. Data model changes.** `issue`/`product`/`resolution` entity types;
ticket provenance; a "gap report" query over low-confidence high-frequency nodes.

**6. Hero feature.** **Reinforcement is the native mechanic of support** — answers
measurably improve as tickets close, and the system tells you which docs to write.

**7. MVP scope.**
- *In:* one helpdesk connector, doc ingest, draft-answer flow, resolution → contribute, gap report.
- *Out:* full agent autopilot, multi-brand, SLA analytics.

**8. Effort.** **Med.** Connectors + draft flow are the new work; furthest from
current dogfooding, so slower to a credible internal demo.

**9. Distribution / GTM.** Helpdesk marketplaces + OSS self-host. Clear ROI story;
**most naturally monetizable later** (per-seat / per-resolution), but that's a
later, post-grow question given the OSS-first frame.

**10. Success metrics.** Draft-acceptance rate, deflection rate, handle-time
reduction, docs created from gap reports, reinforcement events/week.

**11. Risks / open questions.**
- Wrong answers are costly in support — needs strong grounding + human-in-the-loop before send.
- Connector maintenance burden (helpdesk APIs).
- Weakest fit with "small **team**" if it drifts toward enterprise CS — keep it small-team scoped.

---

## Idea 5 — The local-first memory layer (horizontal primitive)

**1. Positioning.** "mem0, but local-first & TypeScript/MCP-native" — a drop-in
memory any builder adds to any agent in one install, no keys, no database to
stand up.

**2. Target user & JTBD.** Developers building agents who want memory without
cloud lock-in or a Python dependency. *"I want durable agent memory I can `npm i`
and run offline."*

**3. Primary flows.**
- `npm i` / `curl | sh` → `read` / `contribute` in library, CLI, or MCP form.
- Bring-your-own store via the `GraphStore` interface; local by default.

**4. Architecture.** **Almost exactly what exists today.** The work is packaging:
crisp API surface, docs, examples, a **published benchmark**, and framework
adapters (LangChain.js, Vercel AI SDK, Mastra).

**5. Data model changes.** Minimal. Maybe stabilize the public types and add
memory "scopes" (user/session/agent) to match how the category is framed.

**6. Hero feature.** **Zero-infra, TS/MCP-native, self-reinforcing memory** — the
combination none of the Python/cloud incumbents offer by default.

**7. MVP scope.**
- *In:* API/docs hardening, adapters for 2–3 JS agent frameworks, a benchmark writeup, examples.
- *Out:* everything vertical (no UI, no connectors, no team features).

**8. Effort.** **Low.** Mostly docs, examples, benchmark, adapters. ~1–2 weeks to
a stronger OSS release.

**9. Distribution / GTM.** Pure GitHub-star play: benchmark blog post, framework
adapter announcements, MCP directory, Show HN. Highest ceiling for stars, hardest
to differentiate on story alone.

**10. Success metrics.** Stars, npm weekly downloads, adapter installs, benchmark
ranking, inbound "who's using it."

**11. Risks / open questions.**
- **Most crowded shelf** — "generic memory" without a sharp use case rarely wins attention; this is why it's framed as the *engine underneath Idea 1*, not the headline.
- Benchmarking honestly against mem0/Zep (LongMemEval) may expose gaps (no temporal graph).
- Positioning risk: "yet another memory lib" fatigue.

---

## Cross-idea summary (for scoring)

| # | Idea | Effort | Risk | New surface to build | OSS virality | Fit w/ current code |
|---|------|--------|------|----------------------|--------------|---------------------|
| 1 | Coding-agent team memory ⭐ | Low–Med | Med | Git sync + code entities | High | Highest (dogfooded) |
| 2 | Team brain (OSS Glean) | Med–High | Med | Web UI + connectors + auth | Med | Med |
| 3 | Onboarding + Slack bot | Med | Low–Med | Slack app | Med | Med |
| 4 | Support graph | Med | Med | Helpdesk connectors + draft flow | Low | Med |
| 5 | Memory primitive | Low | High | Docs/adapters/benchmark | High | Highest (as-is) |

**Recommended path (unchanged):** ship **Idea 5's engine, packaged as Idea 1**,
grow it OSS through developers, and let real-world usage pull toward **Idea 2**.
Ideas 3 and 4 are strong standalone verticals if a specific design partner /
pain shows up first.

### The single sentence to defend
> **Local-first + team-shared + TypeScript/MCP-native + self-reinforcing** —
> the square of the memory market that no current player occupies.

---

## Questions the reviewing model should pressure-test

1. Is **team sync via git (Mode A)** genuinely robust given embeddings live in the graph, or does it force Mode B (a server) sooner than claimed?
2. Is "coding-agent team memory" (Idea 1) a **strong enough wedge vs ByteRover**, or is the differentiation too thin?
3. Does the **near-idempotent merge** actually hold under concurrent multi-writer merges, or are there conflict cases (e.g., two different summaries, contradictory facts) that need explicit resolution / a temporal layer?
4. For pure-OSS grow-first, is Idea 1 or Idea 5 the better **top-of-funnel**, given 1 has a sharper story but 5 is closer to shippable today?
5. Which idea best withstands the **"generic memory is commoditizing"** risk over a 12-month horizon?
6. What's the **smallest possible v1** that proves the "gets smarter with team use" claim to real users?
