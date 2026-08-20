/**
 * `graft viz --export <dir>`: the same viewer, as one self-contained HTML file.
 *
 * This exists so a PR comment has somewhere real to point. A Mermaid diagram in a
 * comment can hold about five circles before it stops being readable, and it can
 * never hold the thing a reviewer actually wants next — click an area, see its
 * dependent symbols at exact `file:line`. Every other tool in this space solved
 * that the same way: keep a small table in the comment and link out to a hosted
 * view. Exporting rather than hosting keeps graft's promise intact — no account, no
 * server, no telemetry; the artifact is a file you can open with `file://`, publish
 * to GitHub Pages, or attach to a build.
 *
 * The output inlines the CSS, the bundled JS and both graphs, because a file served
 * from a Pages subdirectory cannot rely on absolute asset paths (`/app.js` resolves
 * to the domain root, not the PR's folder) and a reader must not need a web server.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assembleContextGraph } from "./assemble.js";

export interface VizExportOptions {
  contextDir: string;
  /** Where index.html, app.js and style.css were bundled (dist/viewer). */
  viewerDir: string;
  /** Directory to write index.html into. Created if absent. */
  outDir: string;
  repoName: string;
  /** Shown in the appbar beside the repo name — e.g. "PR #151". */
  subtitle?: string;
}

export interface VizExportResult {
  file: string;
  bytes: number;
  contextNodes: number;
  codeNodes: number;
  /** Tab the exported page opens on — see the reasoning in {@link exportViz}. */
  defaultTab: "context" | "code";
}

/** The wiring graph as the viewer's endpoint would have served it, or null. */
function codeGraph(contextDir: string): unknown {
  const file = join(contextDir, ".graph", "wiring.json");
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { meta?: { version?: number } };
    return parsed?.meta?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * JSON safe to drop inside a `<script>` element.
 *
 * `</script>` anywhere in the data — a summary quoting HTML, a symbol named after a
 * tag — would close the element and spill the rest of the graph into the page as
 * text. `<` is escaped as a unicode sequence, which is still valid JSON to the
 * parser and inert to the HTML tokenizer.
 */
function inlineJson(value: unknown): string {
  return JSON.stringify(value ?? null)
    .replace(/</g, "\\u003c")
    // Line and paragraph separators are legal in a JSON string and illegal in a
    // JavaScript source line, so an unescaped one is a syntax error at load time.
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function exportViz(opts: VizExportOptions): VizExportResult {
  const html = readFileSync(join(opts.viewerDir, "index.html"), "utf8");
  const css = readFileSync(join(opts.viewerDir, "style.css"), "utf8");
  const js = readFileSync(join(opts.viewerDir, "app.js"), "utf8");

  const context = assembleContextGraph(opts.contextDir);
  const code = codeGraph(opts.contextDir);

  // Which tab to open on. The viewer starts on Context, which only a `--deep` build
  // fills: a structural build writes wiring cards (no frontmatter, so nothing to
  // assemble) and INDEX.md, and INDEX alone assembles to a single node. Since the
  // PR path is now structural by design, opening on Context would show a canvas
  // with one dot while the whole wiring graph sat behind an unadvertised tab.
  const codeNodes = (code as { nodes?: unknown[] } | null)?.nodes?.length ?? 0;
  const defaultTab = context.nodes.length > 1 || codeNodes === 0 ? "context" : "code";
  const contextGraph = {
    ...context,
    meta: { ...context.meta, repoName: opts.repoName, subtitle: opts.subtitle, defaultTab },
  };

  const data = [
    "<script>window.__GRAFT_DATA__ = {",
    `  contextGraph: ${inlineJson(contextGraph)},`,
    `  codeGraph: ${inlineJson(code)}`,
    "};</script>",
  ].join("\n");

  // Replacer FUNCTIONS, not replacement strings: `$&`, `$\'` and friends are
  // substitution patterns inside a replacement string, and a minified bundle is
  // full of them — the first version of this put the original `<script src>` tag
  // back into the page via a stray `$&` in app.js. A function is taken verbatim.
  const page = html
    .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="/app.js"></script>', () => `${data}\n<script type="module">\n${js}\n</script>`);

  // A replacement that silently did nothing would ship a page fetching /app.js from
  // the domain root, which 404s on Pages and shows an empty viewer.
  if (page.includes('href="/style.css"') || page.includes('src="/app.js"')) {
    throw new Error("viz export: viewer/index.html no longer matches the asset tags this exporter rewrites");
  }

  mkdirSync(opts.outDir, { recursive: true });
  const file = join(opts.outDir, "index.html");
  writeFileSync(file, page);
  return { file, bytes: Buffer.byteLength(page), contextNodes: contextGraph.nodes.length, codeNodes, defaultTab };
}
