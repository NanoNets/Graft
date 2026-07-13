# Benchmark harness

Measures the product's central claim: **an agent that reads the context graph before a task
costs less (tokens + latency) than an agent that explores from cold — without losing correctness.**

## What it does

For each corpus it ingests the graph once, then runs every task through two arms of the **same**
Claude Sonnet 5 agent loop with the **same** filesystem tools (`read_file`, `grep`, `glob`, `list_dir`):

- **Cold** — the agent starts from zero and explores to find the answer.
- **Graph** — the agent additionally gets the `engine.read(question)` context bundle injected up front.

Every run records input/output tokens, tool-call count, wall-clock, and a correctness score. Correctness
is scored by an **Opus 4.8 judge** (against a reference answer) gated by a **required-keyword** floor, so a
fast-but-wrong answer can't score a win. Each task runs N trials to average out agent stochasticity.

The result is a per-corpus table (cold vs graph, with deltas) — the artifact for the README/launch.

## Requirements

- `OPENROUTER_API_KEY` — that's it. The agent (`anthropic/claude-sonnet-5`), judge
  (`anthropic/claude-opus-4.8`), and graph extraction all run through OpenRouter. Embeddings run
  locally in-process. Override the models with `BENCH_AGENT_MODEL` / `BENCH_JUDGE_MODEL`.

## Run

```bash
npm run bench -- --smoke                 # 1 corpus, 1 task, 1 trial — plumbing check
npm run bench                            # full: all corpora, all tasks, 3 trials
npm run bench -- --corpora unified-accounts-login-server --tasks 3 --trials 2
npm run bench -- --arms graph            # a single arm
```

Results are written to `bench/results/<timestamp>.json` (raw per-trial rows) and `<timestamp>.md`
(the summary table, also printed to stdout).

## Corpora

Defined in `bench/tasks.ts`. The two code repos are expected as **siblings** of this repo under the
same parent directory; override any path with `BENCH_REPO_<ID_UPPER>` (dashes → underscores), e.g.
`BENCH_REPO_NEW_WEBSITE=/path/to/site`.

- `unified-accounts-login-server` — the Nanonets unified auth service (Node/Express). Small, so cheap to
  ingest; ground truth authored from the source (Auth0 flow, session JWT, redirect logic, config).
- `new-website` — the Nanonets marketing site (Next.js App Router, ~342 `.tsx`). Its README is
  `create-next-app` boilerplate, so every answer requires reading code — a clean cold-arm test.
- `northwind-docs` — the demo PDFs in `examples/demo-docs`; ground truth from `scripts/make-demo-pdfs.mjs`.
  A knowledge-folder data point (segment 3).

**Fairness note:** `ingestRepo` summarizes only code files (`CODE_EXTENSIONS`), so README / markdown /
`package.json` / CSS never enter the graph, while the cold agent *can* read them. Tasks are therefore
written to require multi-file **code** understanding, not README/config lookups.

To add another repo (e.g. `assign`): clone/point at it, add a `kind: "repo"` corpus entry in
`bench/tasks.ts` with tasks whose answers you can verify from its docs or code.

## Reading the result honestly

The claim holds only if the graph arm is **both** materially cheaper/faster **and** at least as correct.
If it's cheaper but less correct, that's a real finding to report — not something the harness hides.
