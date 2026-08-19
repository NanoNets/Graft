/**
 * Renderers for a {@link BlastReport}: the Mermaid+markdown comment body a CI job
 * posts, and a plain-text report for a terminal.
 *
 * The diagram is the product here — a reviewer should see which modules a change
 * reaches before reading a single path — so the markdown leads with it and keeps
 * the per-symbol detail collapsed underneath. GitHub renders Mermaid natively in
 * comments, so there is nothing to host and no image to generate.
 */
import type { BlastReport, ImpactedModule } from "./blast.js";

/** Diagram caps. A 200-file PR must still produce a diagram GitHub will draw, and
 * anything dropped is stated in the body rather than silently truncated. */
const MAX_CHANGED_BOXES = 10;
const MAX_MODULE_BOXES = 8;
/** Symbols listed per module in the collapsed detail. */
const MAX_SYMBOLS_LISTED = 25;

/**
 * A quoted Mermaid label. Every line is escaped on its own and only then joined
 * with `<br/>` — escaping the joined string would eat the tag's own angle brackets
 * and render the literal text "br/" inside the box.
 */
function label(...lines: string[]): string {
  return `"${lines.map(escapeLabel).join("<br/>")}"`;
}

/** Quotes end a Mermaid label, and angle brackets would inject markup into it. */
function escapeLabel(text: string): string {
  return text.replace(/"/g, "#quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

function depthLabel(depth: number): string {
  return Number.isFinite(depth) ? `depth ${depth}` : "full closure";
}

/**
 * Node colours, taken from `graft viz`'s own palette (viewer/style.css) so the two
 * pictures of the same graph read as one thing: amber is the file you touched
 * (`--k-file`), teal is what depends on it (`--k-method`, the colour the viewer uses
 * for dependents), grey is the edge (`--edge`). Fill AND text colour are set
 * explicitly on every node, because a GitHub comment renders in either theme and a
 * node that inherits one of them is illegible in the other.
 */
const VIZ = {
  changedFill: "#F7E7CE",
  changedStroke: "#D98E2B",
  changedInk: "#3D2A0E",
  moduleFill: "#D9EDF3",
  moduleStroke: "#3AA7C9",
  moduleInk: "#0E313C",
  edge: "#9AA4A9",
} as const;

/**
 * Changed files ordered by how much they actually reach, so the box cap keeps the
 * files a reviewer needs.
 *
 * This ordering is not cosmetic. Arrows can only be drawn between boxes that exist,
 * so with the cap applied in diff order a 23-file PR drew ten arbitrary files and
 * dropped almost every arrow — the diagram then said "nothing depends on any of
 * this", which is the opposite of the truth.
 */
function changedByReach(r: BlastReport, modules: ImpactedModule[]): string[] {
  const reach = new Map<string, { modules: number; symbols: number }>();
  for (const mod of modules) {
    for (const from of mod.from) {
      const at = reach.get(from) ?? { modules: 0, symbols: 0 };
      at.modules++;
      at.symbols += mod.symbols.length;
      reach.set(from, at);
    }
  }
  return r.changed
    .filter((c) => !r.unindexed.includes(c.path) && !r.deleted.includes(c.path))
    .map((c) => c.path)
    .sort((a, b) => {
      const ra = reach.get(a);
      const rb = reach.get(b);
      return (rb?.modules ?? 0) - (ra?.modules ?? 0) || (rb?.symbols ?? 0) - (ra?.symbols ?? 0) || a.localeCompare(b);
    });
}

/**
 * The Mermaid flowchart: changed files on the left, affected modules on the right.
 *
 * Returns null when there is nothing to draw — an empty diagram frame reads as a
 * broken renderer, and the caller has a sentence for "no dependents found".
 */
export function mermaidDiagram(r: BlastReport): string | null {
  const modules = r.modules.slice(0, MAX_MODULE_BOXES);
  if (modules.length === 0) return null;

  const ranked = changedByReach(r, modules);
  const changedShown = ranked.slice(0, MAX_CHANGED_BOXES);
  if (changedShown.length === 0) return null;

  const changedId = new Map(changedShown.map((path, i) => [path, `C${i}`]));
  const lines = ["flowchart LR", '  subgraph changed["changed in this PR"]', "    direction TB"];
  for (const path of changedShown) lines.push(`    ${changedId.get(path)}[${label(path)}]`);
  lines.push("  end");

  modules.forEach((mod, i) => {
    const detail = `${plural(mod.files.length, "file")} · ${plural(mod.symbols.length, "symbol")}`;
    lines.push(`  M${i}[${label(mod.label, detail)}]`);
  });

  // One arrow per (changed file → module) pair the walk actually recorded.
  let hiddenArrows = 0;
  modules.forEach((mod, i) => {
    for (const from of mod.from) {
      const id = changedId.get(from);
      if (id) lines.push(`  ${id} --> M${i}`);
      else hiddenArrows++;
    }
  });

  lines.push(`  classDef changedNode fill:${VIZ.changedFill},stroke:${VIZ.changedStroke},stroke-width:1px,color:${VIZ.changedInk};`);
  lines.push(`  classDef moduleNode fill:${VIZ.moduleFill},stroke:${VIZ.moduleStroke},stroke-width:1px,color:${VIZ.moduleInk};`);
  if (changedShown.length > 0) {
    lines.push(`  class ${changedShown.map((p) => changedId.get(p)).join(",")} changedNode;`);
  }
  lines.push(`  class ${modules.map((_, i) => `M${i}`).join(",")} moduleNode;`);
  // linkStyle needs explicit indices; every arrow drawn so far is one link, in order.
  const arrowCount = lines.filter((l) => l.includes(" --> ")).length;
  if (arrowCount > 0) {
    lines.push(`  linkStyle ${Array.from({ length: arrowCount }, (_, i) => i).join(",")} stroke:${VIZ.edge},stroke-width:1.5px;`);
  }
  if (hiddenArrows > 0) lines.push(`  %% ${hiddenArrows} arrow(s) from changed files not drawn (box cap)`);

  return lines.join("\n");
}

/** The PR-comment body: diagram, then collapsed per-symbol detail, then caveats. */
export function markdownReport(r: BlastReport): string {
  const out: string[] = [];
  const symbols = r.modules.reduce((n, m) => n + m.symbols.length, 0);

  out.push("### 🌱 graft blast radius");
  out.push("");
  if (symbols === 0) {
    out.push(headline(r, symbols));
  } else {
    out.push(headline(r, symbols));
    const diagram = mermaidDiagram(r);
    if (diagram) {
      out.push("");
      out.push("```mermaid");
      out.push(diagram);
      out.push("```");
      const notes: string[] = [];
      const hiddenModules = r.modules.length - MAX_MODULE_BOXES;
      if (hiddenModules > 0) notes.push(`${plural(hiddenModules, "further module")} not drawn`);
      const drawable = r.changed.length - r.unindexed.length - r.deleted.length;
      if (drawable > MAX_CHANGED_BOXES) {
        notes.push(`${drawable - MAX_CHANGED_BOXES} of ${drawable} changed files not drawn (the ones reaching the most modules are kept)`);
      }
      if (notes.length > 0) {
        out.push("");
        out.push(`_${notes.join("; ")}. Everything is listed below._`);
      }
    }
    out.push("");
    for (const mod of r.modules) out.push(...moduleDetail(mod));
  }

  const caveats = caveatLines(r);
  if (caveats.length > 0) {
    out.push("");
    for (const line of caveats) out.push(line);
  }
  out.push("");
  out.push(`<sub>\`graft blast\` · ${r.basis} · ${depthLabel(r.depth)}</sub>`);
  return out.join("\n") + "\n";
}

function headline(r: BlastReport, symbols: number): string {
  const changed = plural(r.changed.length, "changed file");
  if (symbols === 0) {
    return `No indexed dependents: nothing outside the ${changed} references what this diff touched.`;
  }
  return `**${plural(symbols, "dependent symbol")}** across **${plural(r.modules.length, "module")}**, reached from ${changed}.`;
}

function moduleDetail(mod: ImpactedModule): string[] {
  // <strong>, not `**` — GitHub does not process markdown emphasis inside a
  // <summary> tag, so asterisks would render as literal asterisks in the header.
  const head = `<strong>${mod.label}</strong> — ${plural(mod.symbols.length, "symbol")} in ${plural(mod.files.length, "file")}`;
  const lines = ["<details>", `<summary>${head}</summary>`, ""];
  for (const s of mod.symbols.slice(0, MAX_SYMBOLS_LISTED)) {
    lines.push(`- \`${s.path}:${s.span}\` — ${s.name} (${s.relation}, depth ${s.depth})`);
  }
  const hidden = mod.symbols.length - MAX_SYMBOLS_LISTED;
  if (hidden > 0) lines.push(`- …${plural(hidden, "more symbol")}`);
  lines.push("");
  lines.push("</details>");
  return lines;
}

/**
 * What the report cannot see. These are the lines that keep a diagram honest: a
 * reader who is not told that four changed files are unindexed will read "no
 * dependents" as "safe".
 */
function caveatLines(r: BlastReport): string[] {
  const out: string[] = [];
  if (r.deleted.length > 0) {
    out.push(
      `⚠️ ${plural(r.deleted.length, "deleted file")} (${r.deleted.slice(0, 5).join(", ")}) — ` +
        "their dependents cannot be computed from a graph built at this commit, since the files are gone from it.",
    );
  }
  if (r.unindexed.length > 0) {
    out.push(
      `⚠️ ${plural(r.unindexed.length, "changed file")} not in the graph (${r.unindexed.slice(0, 5).join(", ")}) — ` +
        "no parser claims the extension, or the index predates the file.",
    );
  }
  return out;
}

/** Terminal report: same content, no markdown scaffolding. */
export function textReport(r: BlastReport): string {
  const symbols = r.modules.reduce((n, m) => n + m.symbols.length, 0);
  const lines = [
    `blast radius — ${r.basis} (${depthLabel(r.depth)})`,
    `  changed: ${plural(r.changed.length, "file")}, ${plural(r.seeds.length, "seed symbol")}`,
    `  impacted: ${plural(symbols, "symbol")} in ${plural(r.modules.length, "module")}`,
    "",
  ];
  for (const mod of r.modules) {
    lines.push(`${mod.label} — ${plural(mod.symbols.length, "symbol")} in ${plural(mod.files.length, "file")}`);
    for (const s of mod.symbols.slice(0, MAX_SYMBOLS_LISTED)) {
      lines.push(`  ${s.relation} ← ${s.name} (${s.path}:${s.span}) [depth ${s.depth}]`);
    }
    const hidden = mod.symbols.length - MAX_SYMBOLS_LISTED;
    if (hidden > 0) lines.push(`  …${plural(hidden, "more symbol")}`);
    lines.push("");
  }
  if (symbols === 0) lines.push("no indexed dependents outside the changed files themselves", "");
  for (const line of caveatLines(r)) lines.push(line.replace(/⚠️ /, "⚠ "), "");
  return lines.join("\n").replace(/\n+$/, "\n");
}
