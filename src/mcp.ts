#!/usr/bin/env node
/**
 * MCP server exposing the context graph to any MCP client (Claude Code, Cursor,
 * etc.). Agents `context_read` before doing work and `context_contribute` what
 * they learn — mirroring the "shared skill / durable memory" integration model.
 *
 * Run: context-graph-mcp   (configure the db via CONTEXT_GRAPH_DB)
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { ContextGraphEngine } from "./engine.js";
import { toHtml } from "./graph/export.js";

const engine = new ContextGraphEngine();

const server = new McpServer({
  name: "context-graph-engine",
  version: "0.1.0",
});

server.registerTool(
  "context_read",
  {
    title: "Read shared context",
    description:
      "Read the shared context graph for a query BEFORE doing work. Returns relevant entities, relationships, and supporting sources as a ready-to-use context block.",
    inputSchema: {
      query: z.string().describe("What you need context about."),
      maxNodes: z.number().int().min(1).max(50).optional().describe("Max entities (default 8)."),
      maxChunks: z.number().int().min(0).max(50).optional().describe("Max source passages (default 6)."),
    },
  },
  async ({ query, maxNodes, maxChunks }) => {
    const bundle = await engine.read(query, { maxNodes, maxChunks });
    return { content: [{ type: "text", text: bundle.prompt }] };
  },
);

server.registerTool(
  "context_contribute",
  {
    title: "Contribute a learning",
    description:
      "Contribute something you learned back into the shared context graph so future agents benefit. It is deduplicated and merged with existing knowledge.",
    inputSchema: {
      learning: z.string().describe("The fact or insight to record, in plain language."),
      agentId: z.string().optional().describe("Your agent identifier (default 'agent')."),
    },
  },
  async ({ learning, agentId }) => {
    const r = await engine.contribute(learning, { agentId });
    return {
      content: [
        {
          type: "text",
          text: `Recorded. +${r.nodesCreated} new entities, ${r.nodesUpdated} reinforced; +${r.edgesCreated} new relationships, ${r.edgesUpdated} reinforced.`,
        },
      ],
    };
  },
);

server.registerTool(
  "context_ingest",
  {
    title: "Ingest a document",
    description: "Ingest a document (raw text) into the shared context graph.",
    inputSchema: {
      text: z.string().describe("The document text to ingest."),
      title: z.string().optional().describe("A title for the document."),
    },
  },
  async ({ text, title }) => {
    const r = await engine.ingest(text, { title });
    return {
      content: [
        {
          type: "text",
          text: r.skipped
            ? "Document already ingested; skipped."
            : `Ingested "${r.title}": ${r.chunks} chunks, +${r.nodesCreated} entities, +${r.edgesCreated} relationships.`,
        },
      ],
    };
  },
);

server.registerTool(
  "context_ingest_file",
  {
    title: "Ingest a file (incl. PDFs)",
    description:
      "Ingest one or more files from disk into the shared context graph. PDF files are parsed to text automatically. Accepts absolute paths.",
    inputSchema: {
      paths: z
        .array(z.string())
        .min(1)
        .describe("Absolute file paths to ingest (e.g. PDFs)."),
    },
  },
  async ({ paths }) => {
    const lines: string[] = [];
    for (const path of paths) {
      try {
        const r = await engine.ingestFile(path);
        lines.push(
          r.skipped
            ? `• ${r.title}: already ingested, skipped`
            : `✓ ${r.title}: ${r.chunks} chunks, +${r.nodesCreated} entities (${r.nodesUpdated} reinforced), +${r.edgesCreated} relationships`,
        );
      } catch (err) {
        lines.push(`✗ ${path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "context_ingest_dir",
  {
    title: "Ingest a directory",
    description:
      "Ingest every supported document (.pdf, .md, .markdown, .txt) in a directory, recursively, into the shared context graph. Point this at a folder of docs and it builds the graph in one call.",
    inputSchema: {
      dir: z.string().describe("Absolute path to the directory of documents to ingest."),
      extensions: z
        .array(z.string())
        .optional()
        .describe('File extensions to include (e.g. [".md", ".rst"]). Default: .pdf .md .markdown .txt'),
    },
  },
  async ({ dir, extensions }, extra) => {
    // Report progress per file. If the client supplied a progressToken (and
    // resets its request timeout on progress, as Claude Code does), this keeps
    // long multi-file ingests from tripping the default 60s tool timeout.
    const progressToken = extra?._meta?.progressToken;
    const onProgress = progressToken
      ? ({ index, total, file }: { index: number; total: number; file: string }) => {
          void extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: index,
              total,
              message: `Ingesting ${file.split("/").pop()} (${index + 1}/${total})`,
            },
          });
        }
      : undefined;
    const results = await engine.ingestDir(dir, { extensions, onProgress });
    if (results.length === 0) {
      return { content: [{ type: "text", text: `No supported files found under ${dir}.` }] };
    }
    const created = results.reduce((a, r) => a + r.nodesCreated, 0);
    const edges = results.reduce((a, r) => a + r.edgesCreated, 0);
    const lines = results.map((r) =>
      r.skipped ? `• ${r.title}: skipped (already ingested)` : `✓ ${r.title}: +${r.nodesCreated} entities, +${r.edgesCreated} relationships`,
    );
    lines.push(`\nTotal: ${results.length} files → +${created} entities, +${edges} relationships.`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "context_ingest_repo",
  {
    title: "Ingest a code repository (as summaries)",
    description:
      "Ingest a code repository into the shared context graph. Each source file is summarized " +
      "into prose (purpose, key exports, dependencies, design decisions) and the summaries are " +
      "ingested — raw code is never fed to the extractor. Incremental: re-running only " +
      "re-summarizes files whose content changed.",
    inputSchema: {
      dir: z.string().describe("Absolute path to the repository root."),
      extensions: z
        .array(z.string())
        .optional()
        .describe('File extensions to treat as code (default: common languages, e.g. ".ts", ".py", ".go").'),
    },
  },
  async ({ dir, extensions }, extra) => {
    const progressToken = extra?._meta?.progressToken;
    const onProgress = progressToken
      ? ({ phase, index, total, file }: { phase: string; index: number; total: number; file: string }) => {
          void extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: index,
              total,
              message: `${phase === "summarize" ? "Summarizing" : "Ingesting"} ${file} (${index + 1}/${total})`,
            },
          });
        }
      : undefined;
    const r = await engine.ingestRepo(dir, { extensions, onProgress });
    const lines = [
      `Repo ingested: ${r.files} code files → ${r.summarized} summarized, ${r.cached} unchanged (cache hits).`,
      ...r.modules.map((m) =>
        m.skipped
          ? `• ${m.title}: unchanged, skipped`
          : `✓ ${m.title}: ${m.chunks} chunks, +${m.nodesCreated} entities, +${m.edgesCreated} relationships`,
      ),
      ...r.errors.map((e) => `✗ ${e}`),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

server.registerTool(
  "context_export",
  {
    title: "Export the graph as HTML",
    description:
      "Write the entire context graph to a self-contained, interactive HTML file that can be opened in a browser to visualize entities and relationships.",
    inputSchema: {
      path: z.string().describe("Absolute path to write the HTML file to (e.g. /tmp/context-graph.html)."),
    },
  },
  async ({ path }) => {
    const g = await engine.exportGraph();
    writeFileSync(path, toHtml(g));
    return {
      content: [
        {
          type: "text",
          text: `Wrote graph (${g.nodes.length} entities, ${g.edges.length} relationships) to ${path}. Open it in a browser to explore.`,
        },
      ],
    };
  },
);

server.registerTool(
  "context_stats",
  {
    title: "Graph statistics",
    description: "Report how much knowledge the shared context graph currently holds.",
    inputSchema: {},
  },
  async () => {
    const s = await engine.stats();
    return {
      content: [
        {
          type: "text",
          text: `documents: ${s.documents}, entities: ${s.nodes}, relationships: ${s.edges}, source passages: ${s.chunks}`,
        },
      ],
    };
  },
);

server.registerTool(
  "context_sync",
  {
    title: "Sync the graph (git mode)",
    description:
      "Team sync (Mode A): import + re-merge the committed graph file, then write the merged graph back so it can be committed. Idempotent — safe to run repeatedly. Uses graph.jsonl next to the db unless a path is given.",
    inputSchema: {
      file: z
        .string()
        .optional()
        .describe("Path to the graph JSONL file (default: graph.jsonl next to the db)."),
    },
  },
  async ({ file }) => {
    const path = file ?? engine.graphFilePath;
    if (!path) {
      return {
        content: [{ type: "text", text: "This graph is in-memory and can't be synced to a file." }],
      };
    }
    const lines: string[] = [];
    if (existsSync(path)) {
      const r = await engine.importJsonl(readFileSync(path, "utf8"));
      for (const w of r.warnings) lines.push(`⚠ ${w}`);
      lines.push(
        `Merged in: +${r.nodesCreated} entities (${r.nodesUpdated} reinforced), ` +
          `+${r.edgesCreated} relationships (${r.edgesUpdated} reinforced).`,
      );
    }
    writeFileSync(path, await engine.exportJsonl());
    const s = await engine.stats();
    lines.push(`Wrote merged graph (${s.nodes} entities, ${s.edges} relationships) to ${path}.`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so we don't corrupt the stdio JSON-RPC channel.
  console.error("context-graph-engine MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
