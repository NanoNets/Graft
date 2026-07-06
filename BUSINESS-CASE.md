# Business Case: Context Graph — the self-hosted team brain

**Decision:** Of the five candidate products in PRODUCT-DESIGNS.md, we are launching
**Idea 2 — a self-hosted "team brain":** point it at a folder of team documents and get a
searchable knowledge graph that answers questions with citations, shows its confidence,
and gets smarter every time someone uses it. Open source, local-first, one process,
one SQLite file.

This document records why — the market logic, the evidence, and the risks — so the
reasoning survives past the launch week.

---

## 1. The problem is real, universal, and unsolved at our price point

Every team past ~10 people develops the same disease: the answers exist, but they live
in a retired engineer's head, a two-year-old Slack thread, page 41 of a runbook PDF,
and a Notion workspace nobody can search. The symptom is the **repeated question** —
"how do we deploy staging?", "who owns billing escalations?" — asked again every time
someone joins or forgets.

The category answer is enterprise search ("Glean for your company"), and it is sold as
**enterprise SaaS**: per-seat pricing, sales calls, and — the part small teams actually
refuse — *shipping every internal document to a third party's cloud*. A 15-person
agency, clinic, lab, or startup has exactly the same disease and none of the budget,
procurement patience, or willingness to exfiltrate its documents.

That gap — **teams of 10–100 who want their knowledge searchable without giving it to
anyone** — is the market. It is precisely the audience that self-hosts Nextcloud
instead of Dropbox and Chatwoot instead of Zendesk, and it congregates in reachable,
free channels (r/selfhosted, Hacker News, awesome-selfhosted lists).

## 2. Why this idea beat the other candidates

We deep-researched the three viable candidates (the two dev-oriented ideas were
excluded by constraint). The finding that decided it: **no candidate wins on empty
whitespace — every category is occupied — so the deciding axis is speed to real
users**, and the candidates differ by an order of magnitude:

| | A: Team brain | B: Slack onboarding bot | C: Support graph |
|---|---|---|---|
| Incumbent | Onyx (30.7k★) — heavyweight | Various SaaS Q&A bots | Chatwoot (34.1k★) + paywalled "Captain AI" |
| Gatekeeper between us and users | **None** | Slack Marketplace | Helpdesk marketplaces |
| Structural friction | Show HN / r/selfhosted post | **5 active workspaces required *before submission*, up to 10 weeks of manual review**, mandatory public HTTPS hosting, scrutiny on message-reading scopes | Zendesk/Intercom connector + 1–3 weeks marketplace review |
| Realistic time to first 10–100 users | **Days** | Months | Weeks |

For a project whose explicit goal is *the first 10–100 users, fast, with a demo today*,
B is disqualified by Slack's own rules and C by connector-plus-review lead time. A is
the only candidate where the entire acquisition loop — build, post, install — is
**permissionless**. Post-launch data for comparable OSS AI tools shows a competent
Show HN averaging ~121 GitHub stars in the first 24 hours; that is the top of exactly
the funnel we need, available on day one, at zero cost.

B and C are not discarded ideas — they are **future surfaces on the same engine**. A
Slack bot and a support-desk integration are distribution channels for a knowledge
graph that already exists. Building A first means B and C later inherit a graph, a
user base, and public proof.

## 3. Why we can win the shelf we're stepping onto

The obvious objection: Onyx already owns "open-source enterprise search" with 30.7k
stars. Why will anyone install ours?

Because Onyx's dominance is also its verified weakness. It is an **enterprise-shaped
deployment**: multiple containers, Postgres, a Vespa search cluster — infrastructure
that assumes a platform team. The r/selfhosted user with a NAS and the 20-person
company with no DevOps function bounce off it. The market leader structurally cannot
serve the low end without abandoning its architecture. That is a classic
low-end-disruption opening:

- **Their install:** a container fleet and a search cluster.
- **Ours:** one process, one SQLite file, embeddings computed in-process, no accounts,
  no API keys required. Your team's entire brain is a file you can copy.

The second differentiator is the product's actual thesis, and it is one the incumbents
don't have: **the graph is alive and it shows receipts.** Every fact carries how many
times it has been observed, a confidence score, and the exact source passages behind
it. Answers cite their evidence. When a teammate contributes a correction, you *watch*
the graph reinforce. Enterprise search treats knowledge as a static index to be
re-crawled; we treat it as a living ledger that compounds with use. For a small team,
that maps to the real fear — "can I trust this answer?" — and answers it visibly.

## 4. Why we built the demo as a local web app with the graph on screen

This was a deliberate GTM decision, and the research forced it:

1. **The differentiation must be visible or it doesn't exist.** The strongest caution
   from the research is that graph-based retrieval is *not* an automatic quality win —
   published benchmarks (arXiv 2502.11371) show GraphRAG failing to beat plain RAG on
   simple single-hop questions. If we demoed a chat box that answers questions, we
   would be indistinguishable from every RAG wrapper of the last three years and would
   read as "Onyx but smaller" — the single biggest identified risk of this launch. So
   the demo's design puts the mechanism on screen: the living graph is permanently
   visible, asking a question lights up the exact facts consulted, every fact wears a
   monospace provenance receipt (`68% · ×2 · 2 sources`), and teaching it something
   makes the reinforced nodes pulse. The moat is the epistemics; the UI exists to make
   the epistemics undeniable in a 30-second screen recording.

2. **A web UI is the product for this buyer, not a veneer.** The constraint was a
   non-developer-oriented standalone product. Our audience's operations manager will
   never run a CLI; "open localhost:4680 and ask" is the whole onboarding. The same
   interface doubles as every marketing asset the launch needs — the Show HN GIF, the
   README screenshot, the hosted demo.

3. **Distribution research dictated the shape of the install.** The channel analysis
   was unambiguous for self-hosted tools in 2026: Docker-first (a single `docker run`
   as the headline), hosted read-only demo as the week-two amplifier, and *not*
   npm-first — native-module installs (SQLite bindings, ONNX runtime) fail behind
   corporate proxies and node-gyp toolchains often enough to burn first-run trust;
   Anthropic itself abandoned npm distribution for Claude Code over exactly this
   failure mode. A self-contained local web server is the artifact that Dockerizes
   into that one-liner without change.

4. **Local-first is the positioning, so the demo must run with zero cloud.** The
   pitch — "your documents never leave your machine" — is falsified by a demo that
   requires an API key. Retrieval, the graph, and provenance all work fully offline;
   a cloud key only upgrades the experience (written answers, richer extraction).
   That graceful degradation is the trust story, demonstrated rather than claimed.

## 5. What winning looks like

The goal is deliberately not a million users; it is **10–100 real installs, fast**,
because for an OSS product that is the flywheel's first turn: installs → GitHub stars
→ list inclusion (awesome-selfhosted) → organic search → more installs.

- **Week 1:** Show HN + r/selfhosted launch. Success: ~100 stars, 10+ confirmed
  installs, 3 users who ask for something (a connector, a feature) — proof of pull.
- **Week 2–4:** hosted read-only demo, Docker image on a registry, README GIF.
  Success: first users we didn't personally cause; first inbound issue from a
  non-developer team.
- **After proof:** B (Slack surface) and C (support surface) become roadmap items
  built on a graph users already trust — entering those markets with evidence instead
  of cold.

## 6. Risks, stated honestly

- **"Onyx but smaller."** The kill risk. Mitigation is the entire demo design
  (visible graph, receipts, reinforcement) plus positioning discipline: we are not
  "enterprise search, lighter" — we are a *living knowledge ledger* for teams that
  will never deploy enterprise search.
- **Graph quality skepticism.** GraphRAG's benchmark record means we must not
  over-claim answer quality. We claim *provenance, confidence, and compounding* —
  properties plain RAG genuinely lacks — and let answer quality be table stakes.
- **Category churn.** The AI-tool graveyard is large; distribution moats are
  temporary. Our durable asset is the graph data users accumulate — the longer a team
  runs it, the more expensive leaving becomes. That is also why the write path
  (contribute/teach) shipped in v1 rather than later: retention is the moat, and
  retention starts at the first contributed fact.
