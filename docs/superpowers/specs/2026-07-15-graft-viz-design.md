# graft viz — Context Graph Visualizer

**Date:** 2026-07-15
**Status:** Approved (interactive design reference: claude.ai artifact "graft viz — design & mockup")

## Purpose

Graft builds two graph artifacts (`.context/*.md` context graph, `.context/graph.json` code graph) but has no way to see them. `graft viz` serves a local, interactive, nanoindex-style visualization of both. Design priorities, in order: (1) edges must mean something to someone building or reviewing code, (2) modern minimal look, (3) scales to large codebases.

## Decisions made during design (with user)

| Question | Decision |
|---|---|
| What to visualize | Both graphs, as tabs — Context (architecture) and Code (symbols) + Outline (tree) |
| Delivery | New `graft viz` CLI command; serves a prebuilt single-page viewer on localhost; auto-opens browser; no npm install/dev-server at runtime |
| MVP interactions | Force graph with zoom/pan/drag, legend filters, detail panel, tree outline, search, dark/light mode, live reload |
| Viewer tech | Vanilla TS, bundled once with esbuild, shipped in the npm package. d3-force for simulation only (Barnes–Hut perf at scale); rendering is hand-rolled SVG |
| Edge design | Semantic: verbs from the code, not invented taxonomy (below) |

## Edge semantics (the core of the design)

### Verb vocabulary — one test, six verbs

Every relation verb must answer a question someone building or reviewing code actually asks. Vague LLM softeners are banned.

| Verb | Question it answers |
|---|---|
| `part_of` / `contains` | where does this live? |
| `uses` / `calls` / `imports` / `depends_on` | what breaks if I change this? |
| `produces` | where does this output come from? |
| `configures` | what changes its behavior without a code change? |
| `validates` | what checks or judges this? (tests, drift checks, scoring) |
| `extends` / `implements` | what contract must this honor? |

**Enforcement:**
1. Engine: the synthesize tool schema (`src/ai/synthesize.ts`) constrains `relation` to a closed enum: `part_of, uses, produces, configures, validates, implements, depends_on`. The LLM must pick one or drop the link.
2. Viewer: legacy graphs are normalized on load — `influences → configures`; `supports`, `defines`, `measures → validates`. Existing `.context/` folders read cleanly without regeneration.

### Chips (legend + filter)

Shown top-left of the canvas: the verbs **actually present in the repo**, with counts. `part_of`/`contains` group under the chip **"part of"**; `calls`/`uses`/`depends_on`/`imports` group under **"uses"** (user-approved names). Every other verb gets its own chip. Clicking toggles that verb's edges. Hover shows the question the verb answers.

### Form encodes reading priority

- **part of** — thick, muted, no arrowhead, shorter force-spring length (hierarchy pulls clusters together; layout, not clutter)
- **uses / produces / configures / validates** — solid, small open-chevron arrowhead
- **extends / implements** — hollow UML-style arrowhead
- **references** (code graph only) — faint dotted, no arrowhead ("mentioned but never called")
- Arrowheads are deliberately subtle: open chevrons at rest, compact filled heads only on focused edges

### Meaning on demand (focus mode)

At rest the graph is quiet (edges ~0.3–0.55 opacity). Selecting a node:
- outgoing edges turn **amber** (`--fil`) = what it depends on
- incoming edges turn **teal** (`--accent`) = what depends on it
- relation verbs are written only on those focused edges
- non-neighbor nodes and edges fade (~0.06–0.2 opacity)
- detail panel mirrors the colors: "Depends on ·" (amber dot) / "Depended on by ·" (teal dot), each entry showing verb + Graft's per-edge description sentence

### Scale strategy (large codebases)

1. **Containment becomes geometry**: past ~200 visible nodes, `contains` edges stop rendering; files collapse into compound nodes with symbol counts, expandable on click (removes ~40–50% of edges).
2. **Level-of-detail by zoom**: zoomed out, only aggregated file↔file dependency edges, width ∝ bundled edge count; zoom reveals individual edges, then labels on focused ones.
3. **Focus is the primary reading mode** at density; ambient edges just show shape.
4. **Trust is visible**: `confidence: "extracted"` edges solid; `"inferred"` dashed.
5. Faint-dotted verbs (`references`) hidden by default past ~500 edges.

(v1 implements 3, 4, 5 fully; 1 and 2 are v2 — v1 must stay usable to ~1,500 nodes via d3-force + persistent-element SVG updates.)

## Architecture

```
src/
├── cli.ts               + viz command: graft viz [dir] [--port 4400] [--no-open]
└── viz/
    ├── assemble.ts        .context/*.md frontmatter → {meta, nodes[], edges[]}
    └── serve.ts           node:http server, SSE live reload, port fallback, open browser
viewer/                    frontend source (vanilla TS + tokens.css), esbuild → dist/viewer/
dist/viewer/               prebuilt bundle shipped in the npm package
```

- **Server** (`node:http`, zero new runtime deps):
  - `GET /` , `/app.js`, `/style.css` — static viewer from `dist/viewer/`
  - `GET /api/context-graph` — parse every `.context/*.md` with gray-matter; nodes from frontmatter, edges from `links`; relation normalization; dangling edges dropped and counted in `meta.droppedEdges`; malformed files skipped and counted in `meta.skippedFiles`
  - `GET /api/code-graph` — streams `graph.json` if present and `meta.version === 1`, else 404 with `{error}`
  - `GET /events` — SSE; `fs.watch` on the context dir, 300 ms debounce → `data: change`
- **Viewer**: tabs Context / Code / Outline; d3-force simulation; SVG with persistent elements (positions updated per tick, not rebuilt); semantic edge rendering per this spec; detail panel (summary, sources, links); search (Enter zooms to best match); theme toggle (localStorage + `prefers-color-scheme`); SSE-driven refetch that morphs the sim in place (matching ids keep positions).
- **CLI**: errors with guidance if the context dir is missing ("run `graft init` first"); Code/Outline tabs show an instructive empty state if `graph.json` absent ("run `graft graph`").

## Visual design

Token-driven, both themes (light default follows OS, toggle persisted). Palette: cool neutrals; accent deep teal `#0B7A69` (light) / `#2FBFA4` (dark); amber `#D98E2B`/`#E0A04A` reserved for "depends on" focus; node categories — system/class blue, concept/interface violet, file amber, function teal, method cyan, type pink, enum green. System font stack (Avenir Next/Segoe UI fallbacks), `ui-monospace` for paths/signatures. Node radius by degree (11 + 2.6·deg, capped). The approved mockup is the visual reference of record.

## Error handling

- No `.context/` → CLI exit 1 with guidance
- Malformed frontmatter → skip node, warn once, count in `meta.skippedFiles`
- Dangling link target → drop edge, count in `meta.droppedEdges`
- Port busy → try next port (up to +10), print final URL
- `graph.json` missing/wrong version → Code & Outline tabs render empty state; Context unaffected

## Testing

- Unit (node test runner, existing style): assembly from fixture `.context/` (frontmatter → edges, normalization, dangling-drop, malformed-skip); code-graph version gate
- Server: endpoint shapes on a random port; SSE fires on file change; port fallback
- End-to-end: run against this repo's own `.context/` and a generated `graph.json`; screenshot check against the design reference

## Out of scope (v1)

Compound-node collapse & zoom LOD (v2), canvas renderer, multi-repo dashboard, editing the graph from the UI, `Ask` (chat) feature from nanoindex.
