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
import { ContextGraphEngine } from "./engine.js";

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
  "context_stats",
  {
    title: "Graph statistics",
    description: "Report how much knowledge the shared context graph currently holds.",
    inputSchema: {},
  },
  async () => {
    const s = engine.stats();
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
