/**
 * CLI wiring for `graft blast` — the command a CI job runs on a pull request.
 *
 * Kept out of cli.ts (argument wiring only) so the diff → seeds → walk → render
 * chain stays unit-testable without shelling out, matching `graph/traverse-cli.ts`.
 */
import { resolve } from "node:path";
import { contextDirFor } from "../context/node-file.js";
import { loadGraphCached } from "../graph/load.js";
import type { GraphV1 } from "../graph/types.js";
import { blastRadiusIn, type BlastReport } from "./blast.js";
import { changedFiles, refExists } from "./diff.js";
import { markdownReport, mermaidDiagram, textReport } from "./render.js";

export type BlastFormat = "text" | "markdown" | "mermaid" | "json";

export interface BlastCliOptions {
  /** Base ref to diff against (`origin/main`); omitted → working tree vs HEAD. */
  base?: string;
  /** Raw `--depth`: a positive integer, or `all`/`full`/`max`. Default 2. */
  depth?: string;
  format?: string;
  /** Ask a model to name the clusters that have no concept name (one call, cached).
   * Opt-in: a local `graft blast` must not need a key or a network round-trip. */
  name?: boolean;
  /** Write the interactive page for this radius here (one self-contained file). */
  exportViz?: string;
  /** The top-level `--dir` override. */
  globalDir?: string;
}

const DEFAULT_DEPTH = 2;

function resolveFormat(raw: string | undefined): BlastFormat {
  if (raw === undefined) return "text";
  if (raw === "text" || raw === "markdown" || raw === "mermaid" || raw === "json") return raw;
  console.error(`✗ --format must be text, markdown, mermaid or json, got "${raw}"`);
  process.exit(1);
}

/** Same grammar as `graft callers --depth`, so the two commands stay learnable together. */
function resolveDepth(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_DEPTH;
  if (/^(all|full|max)$/i.test(raw)) return Number.POSITIVE_INFINITY;
  const d = Number(raw);
  if (!Number.isFinite(d) || d < 1) {
    console.error(`✗ --depth must be a positive number or "all", got "${raw}"`);
    process.exit(1);
  }
  return Math.floor(d);
}

export async function runBlastCommand(dir: string, opts: BlastCliOptions): Promise<void> {
  const root = resolve(dir);
  const contextDir = contextDirFor(root, opts.globalDir);
  const format = resolveFormat(opts.format);
  const depth = resolveDepth(opts.depth);

  const graph = loadGraphCached(contextDir);
  if (!graph) {
    console.error(`✗ no graph found at ${contextDir} — run \`graft build\` first`);
    process.exit(1);
  }

  // An unknown base is the most common CI misconfiguration by a distance: an
  // `actions/checkout` without `fetch-depth: 0` leaves the base branch absent, and
  // git's own message ("unknown revision or path not in the working tree") sends
  // people looking for a typo instead of the checkout depth.
  if (opts.base !== undefined && !refExists(root, opts.base)) {
    console.error(
      `✗ base ref "${opts.base}" is not in this checkout.\n` +
        "  In CI, fetch enough history for the merge base: actions/checkout with `fetch-depth: 0`.",
    );
    process.exit(1);
  }

  const diff = changedFiles(root, opts.base);
  if (!diff) {
    console.error(`✗ could not read a diff in ${root} — is this a git repository?`);
    process.exit(1);
  }

  const report = blastRadiusIn(graph, contextDir, diff.files, diff.basis, depth);
  if (opts.name) await nameClusters(graph, report, contextDir);
  if (opts.exportViz) await exportRadius(report, contextDir, root, opts.exportViz);

  if (format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (format === "mermaid") {
    const diagram = mermaidDiagram(report);
    // Exit 0 with a comment, not an error: "nothing depends on this diff" is a
    // legitimate answer, and a CI step must not fail on it.
    console.log(diagram ?? "%% no dependents to draw");
    return;
  }
  process.stdout.write(format === "markdown" ? markdownReport(report) : textReport(report));
}

/**
 * Name the clusters left on their symbol backstop, then report what it cost.
 *
 * Everything here is best-effort by construction: no key, a spent quota or a
 * refused call leaves the backstop labels in place and the command still exits 0,
 * because a PR check must not fail over a cosmetic layer.
 */
async function nameClusters(graph: GraphV1, report: BlastReport, contextDir: string): Promise<void> {
  const { applyNames, ChatNamer } = await import("./name.js");
  const { resolveConfig } = await import("../ai/providers.js");
  const cfg = resolveConfig({ contextDir });

  let namer;
  if (cfg.chatModel) {
    namer = new ChatNamer(cfg.chatModel);
  } else if (cfg.apiKey) {
    const { createChatModel } = await import("../ai/llm/factory.js");
    namer = new ChatNamer(createChatModel({
      provider: cfg.provider, apiKey: cfg.apiKey, model: cfg.model,
      baseUrl: cfg.baseUrl, headers: cfg.headers,
    }));
  }

  const stats = await applyNames(graph, report, { namer, contextDir });
  if (!namer) {
    console.error("• --name: no API key (GRAFT_API_KEY), so areas keep their symbol names");
    return;
  }
  if (stats.error) console.error(`• --name: naming failed (${stats.error}) — areas keep their symbol names`);
  else if (stats.named + stats.cached + stats.declined > 0) {
    const bits = [`${stats.named} named`, `${stats.cached} cached`];
    if (stats.declined > 0) bits.push(`${stats.declined} left as symbols (mixed)`);
    console.error(`• --name: ${bits.join(", ")}`);
  }
}

/**
 * Write the interactive page for this radius: the same viewer `graft viz` serves,
 * with the blast graph as its Context tab.
 *
 * Done here rather than in `viz` because the radius is what a reviewer opened the
 * link for, and only `blast` has it — `viz --export` on its own can offer the deep
 * tier's concept map, which a PR build no longer produces.
 */
async function exportRadius(report: BlastReport, contextDir: string, root: string, outDir: string): Promise<void> {
  const { basename, resolve: resolvePath } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { exportViz } = await import("../viz/export.js");
  const { blastVizGraph } = await import("./viz.js");

  const out = exportViz({
    contextDir,
    viewerDir: fileURLToPath(new URL("../viewer/", import.meta.url)), // prebuilt, ships in dist
    outDir: resolvePath(outDir),
    repoName: basename(root),
    contextGraph: blastVizGraph(report),
  });
  console.error(`• --export-viz: ${out.file} (${Math.round(out.bytes / 1024)} kB, ${out.contextNodes} areas, ${out.codeNodes} code nodes)`);
}
