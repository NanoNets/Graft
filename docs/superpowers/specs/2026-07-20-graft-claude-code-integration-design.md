# Graft × Claude Code integration — design

**Date:** 2026-07-20
**Status:** Draft for review
**Owner:** Shrish
**Scope:** One implementation plan.

## 1. Goal

Make Graft *visible and active* inside a Claude Code session — a live statusline
that surfaces what Graft holds, and hooks that feed the graph to the model. Today
Graft is a passive `graft/` folder that an agent is *supposed* to read. This
feature ships a `.claude/` integration that:

1. **Shows** the developer what Graft holds and whether it's trustworthy (a live statusline).
2. **Feeds** relevant graph context into the model automatically (retrieval + orientation + blast-radius).
3. **Keeps itself fresh** — auto-syncs the graph after edits, at `$0`, with no manual command.

Every number shown must be real. No fabricated "tokens saved %", no misleading
dollar cost. If a signal can't be measured honestly, it isn't displayed.

## 2. Background & constraints (grounded in the engine)

- Graft = `@nanonets/graft` v0.2.1, a Node/TS **CLI + library**. No daemon, no MCP.
  Commands: `graft build` / `ask` / `check` / `viz`.
- State on disk under `<repo>/graft/`:
  - `graft/.graph/wiring.json` — deterministic code graph. Top-level `meta`
    (`{version, nodeCount, edgeCount, languages[]}`), `nodes[]` (each with
    `id, name, kind, path, span, signature, exported, body_hash, summary_state,
    summary, crux`), `edges[]` (`{from, to, relation, confidence}`,
    `relation ∈ contains|calls|imports|references|implements|extends`).
  - `graft/*.md` — concept nodes (LLM prose) with typed `[[wikilinks]]`.
  - `graft/manifest.json` — roster + `repoDigest` + per-file hashes.
  - `graft/INDEX.md` — human-readable map (~4.4 KB).
  - `graft/.cache/` — **gitignored**; safe home for session state + sync lock.
- Measured facts that shape the design:
  - `graft check --json` runs in **~0.35s**, read-only, and returns precise drift:
    `graph.changed[]` (files *and* symbols), `graph.added/removed`, `context.contentDrift[]`, and `ok: false` when stale.
  - Plain `graft build` = **structural, deterministic, offline, `$0`**.
    `graft build --deep` = the LLM pass (summaries/crux) that spends OpenRouter
    credits and needs `OPENROUTER_API_KEY`; without a key it degrades to structural.
  - Graft has **no token/cost meter**. There is no runtime signal for "tokens saved".
- Claude Code `.claude/` surface we rely on (confirmed against docs):
  - `statusLine` (command): runs a script per render, receives a JSON blob on
    **stdin** including `model`, `cwd`, `session_id`, `agent.name`, and
    `context_window.{used_percentage, total_input_tokens, total_output_tokens}` and
    `cost.total_cost_usd`. Re-renders several times/second while streaming → the
    script **must be a fast pure reader**.
  - `subagentStatusLine` — per-subagent row.
  - `footerLinksRegexes` — regex → clickable link in the transcript.
  - Hooks (command scripts, JSON on stdin, can inject context via
    `additionalContext` / `hookSpecificOutput`): `SessionStart`, `UserPromptSubmit`,
    `PreToolUse`, `PostToolUse`, `Stop`.

**Honesty grading** used throughout:
- **real** — already on disk (`wiring.json`) or in stdin (`context_window`).
- **instrumented→real** — a small hook captures it honestly (reads count, drift, dirty).
- **not measurable** — dollar cost (misleading estimate) and "tokens saved %" (no baseline). **Excluded by design.**

## 3. Scope

**In scope (9 features):**

| # | Feature | Surface | Honesty |
|---|---------|---------|---------|
| D1 | Status bar (2-line) | `statusLine` | real |
| D2 | Drift beacon (`⚠ N stale`) | `statusLine` + PostToolUse flag | instrumented→real |
| D3 | Per-subagent region | `subagentStatusLine` | real |
| D4 | Clickable node refs | `footerLinksRegexes` | real |
| F1 | Active retrieval (`graft ask` → inject) | `UserPromptSubmit` | real |
| F2 | Session orientation (`INDEX.md` → inject) | `SessionStart` | real |
| F3 | Blast-radius nudge (edges → inject) | `PostToolUse · Edit` | real |
| O1 | Drift flag (mark dirty) | `PostToolUse · Edit` | instrumented→real |
| S1 | Auto-sync (turn-end background rebuild) | `Stop` | real |

**Explicitly out of scope (deferred):**
- Pre-grep short-circuit (`PreToolUse · Grep`) — powerful but intrusive; needs tuning.
- Coverage-gap detector — nice, not core to this deliverable.
- Graft-read usage counter as a *displayed number* — we will **capture** graft-vs-source
  reads in state (cheap), but only surface it once we trust it; the bar ships without it if noisy.
- `$` cost and "tokens saved %" — never shipped (not measurable).
- A `graft claude-init` CLI subcommand to scaffold this into *other* repos — the helpers
  will be written to be liftable, but productizing the installer is a separate plan.
- Debounced live watcher / session-end-only sync — rejected in favor of turn-end sync.

## 4. Architecture — readers vs. writers, one state file

The core pattern: the **statusline only reads**; **hooks write and act**. They meet
at one small gitignored state file, so rendering never invokes Graft and the
expensive work happens only on real events.

```
                       ┌─────────────────────────────┐
   edits / prompts ───▶│  graft-hooks.cjs (writer)   │──▶ graft ask / build / check
                       │  post-edit · prompt · stop  │      (episodic, not per-paint)
                       └──────────────┬──────────────┘
                                      │ writes
                                      ▼
                       ┌─────────────────────────────┐
                       │  graft/.cache/  (state)     │
                       │   stats.json · session/*    │
                       │   .sync.lock                │
                       └──────────────┬──────────────┘
                                      │ reads (small files only)
                                      ▼
   Claude Code stdin ───────▶ graft-statusline.cjs (reader) ──▶ the 2-line bar
```

### Files shipped

| Path | Role | Responsibility |
|------|------|----------------|
| `.claude/settings.json` | config | wire `statusLine`, `subagentStatusLine`, `footerLinksRegexes`, and 4 hook events |
| `.claude/helpers/graft-statusline.cjs` | reader | pure/fast: read `stats.json` + `session/<id>.json` + stdin → render bar. Never calls Graft. |
| `.claude/helpers/graft-hooks.cjs` | writer | single dispatcher: `session-start` \| `prompt` \| `post-edit` \| `stop`. Runs Graft, writes state, injects context. |
| `graft/.cache/stats.json` | state | precomputed `{nodeCount, edgeCount, languages, enrichedPct, staleCount, dirty, syncedAt}` for the statusline |
| `graft/.cache/session/<session_id>.json` | state | per-session: `{lastQuery, perAgentQuery, graftReads, sourceReads}` |
| `graft/.cache/.sync.lock` | lock | one background `graft build` at a time |

CJS Node scripts, no new dependencies (matches Graft's own stack). All paths
resolved relative to `CLAUDE_PROJECT_DIR` with a `$HOME` fallback.

## 5. The status bar (D1/D2)

Two lines. Top = Graft's own state (capture/coverage/freshness). Bottom = session
reality from Claude Code stdin. Example:

```
◤ graft · 319 nodes / 730 edges · 100% enriched · ⚠ 4 stale
▸ ctx 34% · syncing… · last: pkce.ts
```

- **Top line** from `stats.json`:
  - `nodeCount` / `edgeCount` (from `wiring.json` meta, precomputed).
  - `enrichedPct` = share of nodes with `summary_state === "ready"` (precomputed).
    **Show this segment only when `readyCount ≥ 1`.** A structural-only graph (no
    `--deep` run) has zero enriched nodes → the segment is hidden entirely; after any
    enrichment it shows `NN% enriched`. Keeps the bar quiet when there's nothing to say.
  - Freshness: `✓ synced` when `dirty=false && staleCount=0`; `⚠ N stale` when drift
    detected; `syncing…` while a background build holds the lock.
- **Bottom line** from stdin + session state:
  - `ctx NN%` = `context_window.used_percentage` (real, unambiguous).
  - sync status verb OR `last: <basename>` of the most recent captured/edited node.
- **Colors** (Nanonets palette, ANSI): indigo `#546FFF` for live/real graft data,
  amber for `⚠ stale` / drift, muted grey for separators. No green. No gradients.
- **Degraded states:** no `wiring.json` → `graft · not built · run graft build`
  (muted). Missing stdin fields → omit that segment, never error.
- **Performance:** reads only small files (`stats.json`, one session file). Optional
  ~2s /tmp memo keyed by `session_id` to coalesce render storms. Never spawns a
  subprocess. (Guards against a load-average storm from shelling out on every render.)

## 6. Feed features

### F1 — Active retrieval (`UserPromptSubmit`)
- On each user prompt, run `graft ask "<prompt>" --json -n 5`.
- Inject the top hits as `additionalContext`, clearly fenced, e.g.:
  ```
  [graft] relevant context for this prompt:
   • PkceVerifier.verify — auth/oauth/pkce.ts:42-71 — validates the PKCE challenge…
   • OAuthClient.exchange — auth/oauth/client.ts:88-120 — …
  ```
- Caps: ≤5 hits, ≤~800 tokens total, each = title · `path:Lx-Ly` · one-line crux.
- `graft ask` is `$0`/no-LLM/lexical-structural, so this is cheap and offline.
- Silent no-op if: graft not built, zero hits, or prompt is trivial (< N chars).
- Records `lastQuery` (and `perAgentQuery[agent]`) into session state for D3.

### F2 — Session orientation (`SessionStart`)
- Inject the head of `graft/INDEX.md` (top concepts / entry points) as
  `additionalContext` so Claude starts oriented instead of re-exploring.
- Cap to a budget (e.g. first ~1.5 KB / top section). Skip on `source: resume`
  if already injected this session. No-op if `INDEX.md` absent.

### F3 — Blast-radius nudge (`PostToolUse · Edit`)
- After an edit to a source file, find nodes in that file and inject their
  **incoming** edges (who `calls`/`imports`/`references`/`depends_on` this) —
  the "what breaks if I change this?" direction.
- From `wiring.json` `edges[]` filtered by `to` ∈ edited file's node ids.
- Cap ≤8, with `+N more`. Format: `↳ used by: OAuthClient.exchange (client.ts), …`.
- Ignore edits under `graft/` itself (no self-referential noise / loops).
- Episodic (once per edit) so parsing `wiring.json` here is fine.

## 7. Auto-sync (S1) + drift flag (O1)

The closed loop:

```
1. edit source        → PostToolUse·Edit sets stats.dirty=true, records last file
2. statusline          → shows "⚠ stale" instantly (reads stats.json)
3. turn ends (Stop)    → graft check --json (~0.35s) → write precise staleCount
4. if dirty & staleCnt → acquire .sync.lock → graft build (structural, $0) in background
5. build done          → recompute stats.json (counts, enrichedPct), dirty=false,
                         staleCount=0, syncedAt=now, release lock
6. statusline          → flips to "✓ synced"
```

- **Money guard (hard rule):** auto-sync runs **only plain `graft build`** —
  structural, offline, `$0`. It **never** runs `--deep`. New/changed nodes sit at
  `summary_state: pending` until the developer manually enriches. No background API spend, ever.
- **Concurrency:** `.sync.lock` (pid + timestamp). If held, skip (a build is already
  running); stale locks (> N min) are reclaimed.
- **Non-blocking:** the build is detached/background so the `Stop` hook returns fast
  and never stalls the UI. Failure logs to `graft/.cache/sync.log`, leaves `dirty=true`
  (bar keeps `⚠`), and never throws.
- **Scope:** v1 runs a full structural `graft build` (fast for this repo). If measured
  slow on large repos, a later optimization scopes to `graph.changed[]` from `check`.
- **Guard against loops:** edits under `graft/` never set dirty and never trigger sync.

## 8. Display extras

### D3 — Per-subagent region (`subagentStatusLine`)
- Render `agent.name` + its `perAgentQuery` (last `graft ask` subject) from session
  state. Falls back to the main bar when no per-agent query exists.

### D4 — Clickable node refs (`footerLinksRegexes`)
- Regex matches `graft/[\w./-]+\.md` mentions in the transcript → link to the local
  file (or the `graft viz` URL, `http://localhost:4400`, if a viz server is detected).
- Lowest priority; pure garnish; ship last.

## 9. Data contracts

**`stats.json`** (writer: post-edit sets `dirty`; stop/build recomputes the rest):
```json
{ "nodeCount": 319, "edgeCount": 730, "languages": ["typescript"],
  "enrichedPct": 100, "staleCount": 0, "dirty": false,
  "syncedAt": "2026-07-20T14:30:00Z", "lastFile": "pkce.ts" }
```
**`session/<session_id>.json`:**
```json
{ "lastQuery": "pkce verification", "perAgentQuery": { "Explore": "…" },
  "graftReads": 6, "sourceReads": 11 }
```
**stdin fields consumed by the statusline:** `session_id`, `agent.name`,
`context_window.used_percentage`. Everything else optional/ignored.

## 10. Error handling & degradation

- Graft not built / no `wiring.json`: statusline shows muted "not built"; hooks no-op.
- `graft` binary not resolvable: hooks no-op; statusline still renders from `stats.json` if present.
- Malformed stdin JSON: render a minimal bar; never crash a hook (crashing a hook can disrupt the session).
- Concurrent Claude Code sessions: state keyed by `session_id`; single global `.sync.lock`.
- Windows console-flash (upstream bug): statusline reads files only — no subprocess spawns — so it doesn't flash.
- All hooks are best-effort: any failure logs to `graft/.cache/*.log` and exits 0.

## 11. Testing

- **Unit:** stdin parse, bar formatting, `enrichedPct` calc, dirty transitions,
  edge filtering for blast-radius, `graft ask` output → injection formatting, lock acquire/release.
- **Integration:** feed recorded hook payloads (JSON on stdin) to `graft-hooks.cjs`
  and assert (a) state writes and (b) injected `additionalContext`. Feed a recorded
  statusline stdin blob and assert the rendered string.
- **Dogfood (manual):** run inside `context-graph-engine`'s own Claude Code session
  (it is already indexed by Graft). Edit a source file, confirm `⚠ stale` → turn end →
  `✓ synced`, and that `--deep` is never invoked (watch for OpenRouter calls = none).

## 12. Rollout

1. Build + dogfood in `context-graph-engine/.claude/` on a feature branch.
2. Keep helpers repo-agnostic (paths via `CLAUDE_PROJECT_DIR`) so they can later be
   emitted by a `graft claude-init` command (separate plan).
3. Merge once the drift→sync loop is verified end-to-end with zero API spend.

## 13. Decisions (resolved 2026-07-20)

1. **`enrichedPct` display:** show the segment **only when `readyCount ≥ 1`**; hide
   entirely for a structural-only graph. (See §5.)
2. **`graftReads` on the bar:** **capture in `session/<id>.json` now, do not display yet.**
   Revisit surfacing it once the number is trusted.
3. **Sync build scope:** **build auto-sync properly** — robust lock, detached
   background process, debounce, and correct `dirty`/`staleCount`/`syncedAt`
   transitions. v1 runs a full structural `graft build`; changed-files scoping is a
   later optimization behind the same interface (not a shortcut on correctness).
