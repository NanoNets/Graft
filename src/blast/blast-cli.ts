/**
 * CLI wiring for `graft blast` — the command a CI job runs on a pull request.
 *
 * Kept out of cli.ts (argument wiring only) so the diff → seeds → walk → render
 * chain stays unit-testable without shelling out, matching `graph/traverse-cli.ts`.
 */
import { resolve } from "node:path";
import { contextDirFor } from "../context/node-file.js";
import { loadGraphCached } from "../graph/load.js";
import { blastRadiusIn } from "./blast.js";
import { changedFiles, refExists } from "./diff.js";
import { markdownReport, mermaidDiagram, textReport } from "./render.js";

export type BlastFormat = "text" | "markdown" | "mermaid" | "json";

export interface BlastCliOptions {
  /** Base ref to diff against (`origin/main`); omitted → working tree vs HEAD. */
  base?: string;
  /** Raw `--depth`: a positive integer, or `all`/`full`/`max`. Default 2. */
  depth?: string;
  format?: string;
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

export function runBlastCommand(dir: string, opts: BlastCliOptions): void {
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
