# Benchmark harness

Measures the product's central claim: **an agent that gets its context from the graft graph
costs less (tokens + latency) than an agent that explores from cold — without losing correctness.**
And, just as deliberately, it measures where that claim is expected to FAIL: localized
single-file tasks, where any pre-built context is plausibly net overhead.

## What it does

For each repo corpus it builds the wiring graph once (Tier-1 tree-sitter, $0, keyless, into a
temp dir — the corpus repo is never written to), then runs every task through three arms of the
**same** Claude Sonnet 5 agent loop with the **same** filesystem tools
(`read_file`, `grep`, `glob`, `list_dir`):

- **Cold** — the agent starts from zero and explores to find the answer.
- **Graph (push)** — the agent additionally gets a `graft ask --source` bundle injected up
  front. The bundle is paid whether or not it helps — this is the "inject context every prompt"
  model.
- **Graft (pull)** — nothing injected; the agent additionally gets `graft_ask` /
  `graft_skeleton` tools over the prebuilt graph and pays for graph context only when it asks.
  This is the just-in-time model the evidence favors.

Every run records uncached input / output / cached tokens (via Anthropic cache-control
breakpoints, mirroring how Claude Code bills), tool-call count, wall-clock, and a correctness
score. Correctness is scored by an **Opus 4.8 judge** (against a reference answer) gated by a
**required-keyword** floor, so a fast-but-wrong answer can't score a win. Each task runs N
trials to average out agent stochasticity.

Tasks carry a **locality** label (`localized` = answerable from one file, `multi-file`), and the
report splits every corpus's table by locality — the honest headline is the split, not the
average.

## Requirements

- A provider key — the agent (`anthropic/claude-sonnet-5`) and judge
  (`anthropic/claude-opus-4.8`) run through the same vendor-neutral provider
  layer as the engine. Set `GRAFT_API_KEY` (+ `GRAFT_PROVIDER` / `GRAFT_BASE_URL`),
  or the legacy `OPENROUTER_API_KEY`. Graph building is keyless. Override the
  models with `BENCH_AGENT_MODEL` / `BENCH_JUDGE_MODEL`.
- The committed baseline was recorded via OpenRouter (no extended thinking). If
  you rerun against the **native** `anthropic` provider, note that current Claude
  models enable adaptive thinking by default, which inflates output tokens — so
  those numbers are not directly comparable to the committed baseline.

## Run

```bash
npm run bench -- --smoke                 # context-engine, 1 task, all arms, 1 trial — plumbing check
npm run bench                            # full: all corpora, all tasks, 3 arms, 3 trials
npm run bench -- --corpora context-engine --tasks 3 --trials 2
npm run bench -- --arms cold,pull        # a subset of arms
```

Results are written to `bench/results/<timestamp>.json` (raw per-trial rows) and `<timestamp>.md`
(the summary table, also printed to stdout). Judge on the **cost** column (cache-aware:
reads ≈0.1×, writes 1.25×) — "total tokens" overstates any arm that front-loads cacheable context.

## Corpora

Defined in `bench/tasks.ts`.

- `context-engine` — graft's own repo; always present, so the bench is self-contained.
  Mixes localized and multi-file tasks; ground truth cited from source at authoring time.
- `unified-accounts-login-server` — the Nanonets unified auth service (Node/Express); expected
  as a **sibling** of this repo (override with `BENCH_REPO_UNIFIED_ACCOUNTS_LOGIN_SERVER`).
- `new-website` — the Nanonets marketing site (Next.js App Router, ~342 `.tsx`); sibling,
  override with `BENCH_REPO_NEW_WEBSITE`. Its README is `create-next-app` boilerplate, so every
  answer requires reading code — a clean cold-arm test.
- `northwind-docs` — currently **skipped**: the wiring graph indexes code only (no docs
  ingestion in the current engine).

Missing corpora are skipped with a message, never a failure.

**Fairness note:** the wiring graph indexes only code tree-sitter can parse, so README /
markdown / `package.json` / CSS never enter the graph, while the cold agent *can* read them.
Code tasks are therefore written to require **code** understanding, not README/config lookups.

To add another repo: add a `kind: "repo"` corpus entry in `bench/tasks.ts` with tasks whose
answers you can verify from its code, each labeled with `locality`.

## Reading the result honestly

The claim holds only if a graft arm is **both** materially cheaper/faster **and** at least as
correct — per locality class. Expected shape based on external evidence and graft's earlier
hono-bench: pull ≥ cold everywhere or nearly free; push helps on multi-file and hurts on
localized. If push wins localized too, or pull loses anywhere, that's a real finding to report —
not something the harness hides.
