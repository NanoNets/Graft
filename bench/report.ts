/**
 * Aggregation and reporting. Turns the raw per-trial rows into the summary
 * table that is the actual launch deliverable: per corpus, cold vs graph, with
 * the token / latency / correctness deltas that either back the pitch or don't.
 */
export interface Row {
  corpus: string;
  taskId: string;
  arm: "cold" | "graph";
  trial: number;
  tokensInput: number;
  tokensOutput: number;
  tokensTotal: number;
  cacheRead: number;
  cacheCreate: number;
  toolCalls: number;
  wallMs: number;
  correct: boolean;
  score: number;
  keywordPass: boolean;
  judgeCorrect: boolean;
  iterations: number;
  stopReason: string | null;
  answer: string;
  reasoning: string;
}

// Sonnet 5 pricing per MTok (standard sticker; intro is $2/$10 through 2026-08-31).
const IN_PER_TOK = 3 / 1_000_000;
const OUT_PER_TOK = 15 / 1_000_000;

/** Approximate USD cost of one agent run, accounting for cache read/write multipliers. */
export function costOf(r: { tokensInput: number; tokensOutput: number; cacheRead: number; cacheCreate: number }): number {
  return (
    (r.tokensInput + r.cacheCreate * 1.25 + r.cacheRead * 0.1) * IN_PER_TOK +
    r.tokensOutput * OUT_PER_TOK
  );
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

interface ArmAgg {
  n: number;
  tokensTotal: number;
  tokensInput: number;
  tokensOutput: number;
  toolCalls: number;
  wallMs: number;
  correctness: number; // fraction 0..1
  score: number;
  cost: number;
}

function aggregate(rows: Row[]): ArmAgg {
  return {
    n: rows.length,
    tokensTotal: mean(rows.map((r) => r.tokensTotal)),
    tokensInput: mean(rows.map((r) => r.tokensInput)),
    tokensOutput: mean(rows.map((r) => r.tokensOutput)),
    toolCalls: mean(rows.map((r) => r.toolCalls)),
    wallMs: mean(rows.map((r) => r.wallMs)),
    correctness: mean(rows.map((r) => (r.correct ? 1 : 0))),
    score: mean(rows.map((r) => r.score)),
    cost: mean(rows.map((r) => costOf(r))),
  };
}

function pctDelta(cold: number, graph: number): string {
  if (cold === 0) return "n/a";
  const d = ((graph - cold) / cold) * 100;
  return (d > 0 ? "+" : "") + d.toFixed(0) + "%";
}

function fmt(n: number): string {
  return n >= 1000 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0);
}

export function buildMarkdown(rows: Row[]): string {
  const corpora = [...new Set(rows.map((r) => r.corpus))];
  const lines: string[] = [];
  lines.push("# Context Graph Engine — Benchmark Results", "");
  lines.push(
    `Agent: Claude Sonnet 5 · Judge: Claude Opus 4.8 · ${rows.length} agent runs total.`,
    "",
    "Each cell is the mean across all tasks × trials for that corpus/arm. " +
      "**Cold** = agent explores with filesystem tools from zero. **Graph** = same agent, " +
      "same tools, plus the graph context bundle injected up front.",
    "",
  );

  for (const corpus of corpora) {
    const cold = rows.filter((r) => r.corpus === corpus && r.arm === "cold");
    const graph = rows.filter((r) => r.corpus === corpus && r.arm === "graph");
    const c = aggregate(cold);
    const g = aggregate(graph);

    lines.push(`## ${corpus}`, "");
    lines.push("| Metric | Cold | Graph | Δ |", "|---|---|---|---|");
    lines.push(`| Total tokens (incl. cached) | ${fmt(c.tokensTotal)} | ${fmt(g.tokensTotal)} | ${pctDelta(c.tokensTotal, g.tokensTotal)} |`);
    lines.push(`| Uncached input tokens | ${fmt(c.tokensInput)} | ${fmt(g.tokensInput)} | ${pctDelta(c.tokensInput, g.tokensInput)} |`);
    lines.push(`| Output tokens | ${fmt(c.tokensOutput)} | ${fmt(g.tokensOutput)} | ${pctDelta(c.tokensOutput, g.tokensOutput)} |`);
    lines.push(`| Tool calls | ${fmt(c.toolCalls)} | ${fmt(g.toolCalls)} | ${pctDelta(c.toolCalls, g.toolCalls)} |`);
    lines.push(`| Wall-clock (s) | ${(c.wallMs / 1000).toFixed(1)} | ${(g.wallMs / 1000).toFixed(1)} | ${pctDelta(c.wallMs, g.wallMs)} |`);
    lines.push(`| Cost / task ($) | ${c.cost.toFixed(4)} | ${g.cost.toFixed(4)} | ${pctDelta(c.cost, g.cost)} |`);
    lines.push(`| Correctness | ${(c.correctness * 100).toFixed(0)}% | ${(g.correctness * 100).toFixed(0)}% | ${(g.correctness * 100 - c.correctness * 100).toFixed(0)} pts |`);
    lines.push(`| Judge score | ${c.score.toFixed(2)} | ${g.score.toFixed(2)} | ${(g.score - c.score).toFixed(2)} |`);
    lines.push("");

    // Judge on COST (cache-aware) + correctness — the economic reality. "Total tokens"
    // includes cache reads billed at ~0.1×, so it overstates the graph arm's true cost.
    const cheaper = g.cost < c.cost;
    const correctnessHeld = g.correctness >= c.correctness - 0.001;
    const verdict = cheaper && correctnessHeld
      ? `✅ Graph is cheaper (${pctDelta(c.cost, g.cost)} cost) and correctness held or improved.`
      : !cheaper && g.correctness > c.correctness + 0.001
        ? `➖ Graph costs more (${pctDelta(c.cost, g.cost)}) but is more correct (+${((g.correctness - c.correctness) * 100).toFixed(0)} pts) — a quality win, not a cost win.`
        : cheaper
          ? `⚠️ Graph is cheaper but correctness dropped ${((c.correctness - g.correctness) * 100).toFixed(0)} pts — not a clean win.`
          : `❌ Graph costs more with no correctness gain on this corpus.`;
    lines.push(verdict, "");
  }
  return lines.join("\n");
}
