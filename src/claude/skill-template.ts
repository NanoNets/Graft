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

**Get context from graft first — two ways, both land here:**

- Ask: \`graft ask "<your task, in plain words>"\` — returns the relevant nodes,
  ranked, with file:line pointers. Add \`--source\` to inline the actual code at
  each span, so the result IS the code you need — no separate file read.
  Ask is cheap (<1s) — re-ask with different phrasings for each sub-question,
  and use structural forms too: \`graft ask "who calls <symbol>"\`.
- Or explore as usual: grep / ls / cat inside \`graft/\`. A grep for any concept,
  symbol, or filename hits the node that covers it; \`graft/INDEX.md\` lists them
  all.

**First contact with an unfamiliar repo:** run \`graft map\` before exploring —
a token-budgeted orientation (dir clusters, hubs, hotspots) built straight from
the wiring graph, no LLM, no key.

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
straight to precomputed edges:

- \`graft callers <symbol>\` / \`graft callees <symbol>\` — who breaks if this
  changes / what does this call — precomputed edges, exact answers; structural
  phrasing inside ask ("who calls X") routes here too.
- \`graft impact <symbol> [-d N]\` — BFS over incoming edges out to depth N: the
  full blast radius of a change.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing.

If a node genuinely lacks a detail you need, ask for a more specific node, and
if it still lacks it, read the source — at the exact file:line the node points
to, not the whole file. Reading whole source files to build understanding is
the thing graft exists to replace.
`;
}
