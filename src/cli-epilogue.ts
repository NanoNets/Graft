/**
 * `graft init`'s closing epilogue: the ASCII wordmark + numbered next steps,
 * printed to stderr after the per-file ✓/·/⚠ lines. Extracted out of cli.ts
 * so the exact text — spacing is hand-aligned, not incidental — can be
 * unit-tested without spawning the CLI.
 */

// The widest line (index 4, tied with index 2 at 26 chars) gets the live
// node/edge stats appended, when a graph exists.
const WORDMARK_LINES = [
  "                   __ _",
  "   __ _ _ __ __ _ / _| |_",
  "  / _` | '__/ _` | |_| __|",
  " | (_| | | | (_| |  _| |_",
  "  \\__, |_|  \\__,_|_|  \\__|",
  "  |___/",
];
const STATS_LINE_INDEX = 4;

interface Step {
  label: string;
  command: string;
  /** Extra continuation lines under this step, left-padded to the same column. */
  extra?: string[];
}

export interface InitEpilogueOptions {
  /** Whether a graft graph exists on disk (built by this run, or a prior one). */
  graphBuilt: boolean;
  /** Node count from the built graph — only meaningful when `graphBuilt`. */
  nodes?: number;
  /** Edge count from the built graph — only meaningful when `graphBuilt`. */
  edges?: number;
}

/** Renders the `graft init` next-steps epilogue (no trailing newline — the
 * caller's `console.error` adds the one trailing newline). */
export function formatInitEpilogue(opts: InitEpilogueOptions): string {
  const { graphBuilt, nodes, edges } = opts;

  const wordmark = [...WORDMARK_LINES];
  if (graphBuilt && nodes !== undefined && edges !== undefined) {
    wordmark[STATS_LINE_INDEX] =
      `${wordmark[STATS_LINE_INDEX]}  ${nodes.toLocaleString("en-US")} nodes · ${edges.toLocaleString("en-US")} edges`;
  }

  const steps: Step[] = [
    ...(graphBuilt ? [] : [{ label: "build the graph", command: "graft build" }]),
    { label: "commit the map", command: 'git add graft .claude && git commit -m "add graft"' },
    { label: "restart your agent", command: "the next session picks up the skill + statusline" },
    {
      label: "try it",
      command: 'graft ask "where is auth handled?"',
      extra: ["graft callers <function> · graft viz"],
    },
  ];

  const indent = "  ";
  const gap = "  ";
  const labelWidth = Math.max(...steps.map((s, i) => `${i + 1}. ${s.label}`.length));
  const columnWidth = indent.length + labelWidth + gap.length;

  const stepLines: string[] = [];
  steps.forEach((s, i) => {
    const prefix = `${indent}${i + 1}. ${s.label}`;
    stepLines.push(prefix.padEnd(columnWidth) + s.command);
    for (const extra of s.extra ?? []) {
      stepLines.push(" ".repeat(columnWidth) + extra);
    }
  });

  return [...wordmark, "", ...stepLines].join("\n");
}
