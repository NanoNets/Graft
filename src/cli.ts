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
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { ContextGraphEngine } from "./engine.js";
import { toHtml, toMermaid } from "./graph/export.js";

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
      await engine.close();
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
      await engine.close();
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
      await engine.close();
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
      await engine.close();
    }
  });

program
  .command("ingest-dir")
  .description("Ingest every supported doc (.pdf .md .txt) in a directory, recursively")
  .argument("<dir>", "directory to ingest")
  .action(async (dir: string) => {
    const engine = engineFrom();
    try {
      const results = await engine.ingestDir(dir);
      if (results.length === 0) {
        console.log(`No supported files found under ${dir}`);
        return;
      }
      for (const r of results) {
        console.log(
          r.skipped
            ? `• ${r.title} — already ingested, skipped`
            : `✓ ${r.title} — ${r.chunks} chunks, +${r.nodesCreated} nodes, +${r.edgesCreated} edges`,
        );
      }
    } finally {
      await engine.close();
    }
  });

program
  .command("export")
  .description("Export the whole graph for viewing (interactive HTML, JSON, or Mermaid)")
  .option("-f, --format <fmt>", "html | json | mermaid", "html")
  .option("-o, --out <path>", "output file (default: context-graph.<ext>)")
  .action(async (opts: { format: string; out?: string }) => {
    const engine = engineFrom();
    try {
      const g = await engine.exportGraph();
      let content: string;
      let ext: string;
      if (opts.format === "json") {
        content = JSON.stringify(g, null, 2);
        ext = "json";
      } else if (opts.format === "mermaid") {
        content = toMermaid(g);
        ext = "mmd";
      } else {
        content = toHtml(g);
        ext = "html";
      }
      const out = opts.out ?? `context-graph.${ext}`;
      writeFileSync(out, content);
      console.log(`✓ wrote ${g.nodes.length} entities / ${g.edges.length} relationships to ${out}`);
      if (ext === "html") console.log(`  open it:  open ${out}`);
    } finally {
      await engine.close();
    }
  });

program
  .command("stats")
  .description("Show graph statistics")
  .action(async () => {
    const engine = engineFrom();
    try {
      const s = await engine.stats();
      console.log(`documents: ${s.documents}\nnodes:     ${s.nodes}\nedges:     ${s.edges}\nchunks:    ${s.chunks}`);
    } finally {
      await engine.close();
    }
  });

/** Resolve the graph-file path for team sync (flag overrides the default). */
function syncFilePath(engine: ContextGraphEngine, flag?: string): string {
  const file = flag ?? engine.graphFilePath;
  if (!file) {
    throw new Error(
      "No graph file path — an in-memory graph can't be synced. Pass --file <path> or use a file-backed --db.",
    );
  }
  return file;
}

program
  .command("push")
  .description("Team sync (git mode): write the graph to a committable JSONL file")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      writeFileSync(file, await engine.exportJsonl());
      const s = await engine.stats();
      console.log(`✓ wrote ${s.nodes} entities / ${s.edges} relationships to ${file}`);
      console.log(`  commit it:  git add ${file} && git commit -m "update context graph"`);
    } finally {
      await engine.close();
    }
  });

program
  .command("pull")
  .description("Team sync (git mode): import + re-merge a teammate's JSONL file")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      if (!existsSync(file)) {
        console.log(`No graph file at ${file} yet — nothing to pull.`);
        return;
      }
      const r = await engine.importJsonl(readFileSync(file, "utf8"));
      for (const w of r.warnings) console.warn(`⚠ ${w}`);
      console.log(
        `✓ merged ${file} — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), ` +
          `+${r.edgesCreated} edges (${r.edgesUpdated} reinforced), ` +
          `+${r.documentsAdded} docs, +${r.chunksAdded} sources`,
      );
    } finally {
      await engine.close();
    }
  });

program
  .command("sync")
  .description("Team sync (git mode): pull a teammate's JSONL, re-merge, then push the merged graph")
  .option("--file <path>", "graph file (default: graph.jsonl next to the db)")
  .action(async (opts: { file?: string }) => {
    const engine = engineFrom();
    try {
      const file = syncFilePath(engine, opts.file);
      if (existsSync(file)) {
        const r = await engine.importJsonl(readFileSync(file, "utf8"));
        for (const w of r.warnings) console.warn(`⚠ ${w}`);
        console.log(
          `↓ merged in — +${r.nodesCreated} nodes (${r.nodesUpdated} reinforced), ` +
            `+${r.edgesCreated} edges (${r.edgesUpdated} reinforced)`,
        );
      }
      writeFileSync(file, await engine.exportJsonl());
      const s = await engine.stats();
      console.log(`↑ wrote merged graph (${s.nodes} entities / ${s.edges} relationships) to ${file}`);
      console.log(`  commit it:  git add ${file} && git commit -m "sync context graph"`);
    } finally {
      await engine.close();
    }
  });

program.parseAsync().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
