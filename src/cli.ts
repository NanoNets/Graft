#!/usr/bin/env node
/**
 * `context-graph` CLI — a thin wrapper over {@link ContextGraphEngine} for use
 * from the shell. Subcommands mirror the engine's core verbs:
 *
 *   ingest / ingest-text  build the graph from docs
 *   query                 read the graph for a query (the agent's "read context")
 *   contribute            write a learning back into the graph
 *   stats                 report how much the graph holds
 *
 * A `--db <path>` flag (or CONTEXT_GRAPH_DB) selects which graph file to use.
 */
import "dotenv/config";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { ContextGraphEngine } from "./engine.js";

const program = new Command();

program
  .name("context-graph")
  .description("Turn docs into a structured context graph that AI agents read from and write back to.")
  .option("--db <path>", "path to the graph database (overrides CONTEXT_GRAPH_DB)");

function engineFrom(): ContextGraphEngine {
  const opts = program.opts<{ db?: string }>();
  return new ContextGraphEngine({ dbPath: opts.db });
}

program
  .command("ingest")
  .description("Ingest one or more files into the graph")
  .argument("<paths...>", "files to ingest")
  .option("-t, --title <title>", "title override (single file only)")
  .action(async (paths: string[], opts: { title?: string }) => {
    const engine = engineFrom();
    try {
      for (const path of paths) {
        const r = await engine.ingestFile(path, { title: paths.length === 1 ? opts.title : undefined });
        if (r.skipped) {
          console.log(`• ${r.title} — already ingested, skipped`);
        } else {
          console.log(
            `✓ ${r.title} — ${r.chunks} chunks, +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), +${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
          );
        }
      }
    } finally {
      engine.close();
    }
  });

program
  .command("ingest-text")
  .description("Ingest text passed as an argument or piped via stdin")
  .argument("[text]", "text to ingest (or pipe via stdin)")
  .option("-t, --title <title>", "document title", "inline")
  .action(async (text: string | undefined, opts: { title: string }) => {
    const engine = engineFrom();
    try {
      const content = text ?? readFileSync(0, "utf8");
      const r = await engine.ingest(content, { title: opts.title });
      console.log(
        r.skipped
          ? `• already ingested, skipped`
          : `✓ ${r.chunks} chunks, +${r.nodesCreated} nodes, +${r.edgesCreated} edges`,
      );
    } finally {
      engine.close();
    }
  });

program
  .command("query")
  .description("Read the graph for a query and print the context bundle")
  .argument("<text>", "the query")
  .option("--json", "output the full bundle as JSON")
  .option("-n, --max-nodes <n>", "max entities to surface", (v) => parseInt(v, 10), 8)
  .option("-c, --max-chunks <n>", "max source passages to surface", (v) => parseInt(v, 10), 6)
  .action(async (text: string, opts: { json?: boolean; maxNodes: number; maxChunks: number }) => {
    const engine = engineFrom();
    try {
      const bundle = await engine.read(text, {
        maxNodes: opts.maxNodes,
        maxChunks: opts.maxChunks,
      });
      console.log(opts.json ? JSON.stringify(bundle, null, 2) : bundle.prompt);
    } finally {
      engine.close();
    }
  });

program
  .command("contribute")
  .description("Contribute a learning back into the graph")
  .argument("<text>", "the learning to record")
  .option("-a, --agent <id>", "agent identifier", "cli")
  .action(async (text: string, opts: { agent: string }) => {
    const engine = engineFrom();
    try {
      const r = await engine.contribute(text, { agentId: opts.agent });
      console.log(
        `✓ contributed — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), +${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
      );
    } finally {
      engine.close();
    }
  });

program
  .command("stats")
  .description("Show graph statistics")
  .action(() => {
    const engine = engineFrom();
    try {
      const s = engine.stats();
      console.log(`documents: ${s.documents}\nnodes:     ${s.nodes}\nedges:     ${s.edges}\nchunks:    ${s.chunks}`);
    } finally {
      engine.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
