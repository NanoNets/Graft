// The graft Claude Code skill, bundled as a string so `graft init` can write it into a
// consumer repo's .claude/skills/graft/SKILL.md — no network fetch, version-locked to the
// installed graft. This is the single source of truth for the skill text; graft's own
// repo copy is regenerated from here when `init` runs in this repo. Mirrors the `.cjs`
// shim pattern in shim-template.ts.
export function skillTemplate(): string {
  return `---
name: graft
description: This repo is indexed by graft/. For ANY task here — understanding
  how something works, finding where code lives, or scoping a change — get your
  context from graft before grepping or reading source files.
---

# graft

This repo's code is summarised in \`graft/\` — small markdown nodes, each
explaining one part in plain prose and naming the exact files and line-spans it
covers. Reading a node costs a few hundred tokens; reading source to rebuild the
same understanding costs thousands.

**Choose the graft tool by task shape — pick the one that answers in a single call:**

- **Locate / understand / "how does X work"** → \`graft ask "<task>" --source\` —
  ranked nodes with the code inlined (\`--source\` gives each hit's ≤8-line crux;
  add \`--full\` only if the crux isn't enough). For a genuinely multi-part
  question, ask once per distinct sub-aspect. **But if an ask returns few or
  weak hits, do NOT re-ask with reworded phrasings — switch tool** (below). The
  ask output tells you when to switch.
- **Every occurrence / "all the X" / a symbol or literal everywhere** →
  \`graft grep "<literal>"\` — exhaustive, grouped by enclosing symbol. Ranked
  ask is top-N and WILL miss instances; grep is the tool for "find them all".
- **A file's whole API surface** → \`graft skeleton <file>\` — every signature in
  ~200 tokens. One call beats several asks when you just need "what's in here".
- **Who uses / what breaks if I change X** → \`graft callers <symbol>\` (add
  \`--depth N\` to walk transitively for the full blast radius); what X itself
  depends on → \`graft callers <symbol> --direction out\`. Run one before
  editing a symbol.
- **First contact with an unfamiliar repo** → \`graft map\` — token-budgeted
  orientation (dir clusters, hubs, hotspots). Read the hub cards it names rather
  than asking per subsystem.

You can also grep / ls / cat inside \`graft/\` directly (the nodes are plain
markdown; \`graft/INDEX.md\` lists them) — but the commands above are faster and
exhaustive where it matters, so reach for them first.

**Match the tool to the task shape:**

- **Understanding, explaining, locating where a change goes** — the node IS the
  answer. Cite files and functions straight from its \`covers:\` list — it gives
  the exact \`file:line\` for every symbol, so you can cite precisely without
  opening the source. The spans are generated from that source and are
  authoritative; don't re-open files just to "double-check" them.
- **Editing:** run \`graft ask "<symbol>" --source\` to pull the exact span's
  code inline, and edit straight from that. Touch the file only to apply the
  change at the named \`file:line\` — never read the whole file to get oriented;
  the pack already oriented you.
- **Exhaustive tasks — "every occurrence / every provider / every caller of
  this pattern":** ranked results are top-N, not a complete list. Run
  \`graft grep "<literal>"\` instead — it's exhaustive over every indexed file,
  grouped by enclosing symbol, and tells you what it couldn't see (unreadable
  or unindexed files). Fall back to raw \`grep -rn\` only for files graft
  doesn't index (docs, configs, new files). Ask alone will miss instances;
  that is expected, not a graft failure.

**Precise graph modes** — for structural questions, skip ranking and go
straight to precomputed edges. It's all one command, \`graft callers\`:

- \`graft callers <symbol>\` — who calls/references this (exact edges, not text);
  structural phrasing inside ask ("who calls X") routes here too.
- \`graft callers <symbol> --direction out\` — the reverse: what this symbol
  itself calls/depends on (the old \`callees\`).
- \`graft callers <symbol> --depth N\` — walk transitively out to depth N for the
  full blast radius of a change (the old \`impact\`).

When the graft MCP server is connected, the same operations are exposed as
tools — \`graft_ask\`, \`graft_callers\` (with \`direction\`/\`depth\`),
\`graft_grep\`, \`graft_skeleton\`, \`graft_map\` — prefer whichever surface is
available.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing.

If a node genuinely lacks a detail you need, ask for a more specific node, and
if it still lacks it, read the source — at the exact file:line the node points
to, not the whole file. Reading whole source files to build understanding is
the thing graft exists to replace.
`;
}
