#!/usr/bin/env node
/**
 * MCP server exposing the context graph to any MCP client (Claude Code, Cursor,
 * etc.). Agents `context_read` before doing work and `context_contribute` what
 * they learn — mirroring the "shared skill / durable memory" integration model.
 *
 * The tool registrations are packaged as {@link createContextGraphMcpServer} so
 * the same server can be driven over stdio (`context-graph-mcp`, below) or over
 * Streamable HTTP by the unified `context-graph serve` command — both sharing a
 * single engine and watcher.
 *
 * Run: context-graph-mcp   (configure the db via CONTEXT_GRAPH_DB)
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { ContextGraphEngine } from "./engine.js";
import { GraphWatcher, type WatchEvent } from "./watch.js";
import { toHtml } from "./graph/export.js";

/** Dependencies a context-graph MCP server binds to. Shared across transports. */
export interface McpDeps {
  /** The (shared) engine every tool operates on. */
  engine: ContextGraphEngine;
  /** Ensure/return the watcher used by `context_watch_dir`. */
  getWatcher: () => GraphWatcher;
  /** Peek at the watcher without creating one (status/unwatch). Defaults to a non-creating view. */
  peekWatcher?: () => GraphWatcher | undefined;
  /** Point the watcher's catch-up progress at a sink for the duration of a watch call. */
  setProgressSink: (sink: ((event: WatchEvent) => void) | undefined) => void;
}

/**
 * Build an {@link McpServer} with the context-graph tools registered against the
 * given dependencies. Every transport (stdio, Streamable HTTP) gets its own
 * server instance, but they can all share one engine + watcher via `deps`.
 */
export function createContextGraphMcpServer(deps: McpDeps): McpServer {
  const { engine } = deps;
  const peekWatcher = deps.peekWatcher ?? (() => undefined);

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
    "context_watch_dir",
    {
      title: "Watch a folder (evolving graph)",
      description:
        "Connect a folder to the graph and keep it evolving: existing documents are ingested now, " +
        "and any file added or edited later is re-ingested automatically for as long as this session " +
        "lives. The folder is registered, so `context-graph watch` (or `context-graph serve`) " +
        "resumes it in future sessions.",
      inputSchema: {
        dir: z.string().describe("Absolute path to the folder to watch."),
        extensions: z
          .array(z.string())
          .optional()
          .describe('File extensions to include (e.g. [".md", ".rst"]). Default: .pdf .md .markdown .txt'),
      },
    },
    async ({ dir, extensions }, extra) => {
      const w = deps.getWatcher();
      // Extensions are fixed per watcher process; a custom set is recorded in
      // the registry and takes effect when a daemon starts from it.
      engine.addWatchedDir(dir, extensions);

      const progressToken = extra?._meta?.progressToken;
      const lines: string[] = [];
      let ingested = 0;
      let queued = 0;
      deps.setProgressSink((event) => {
        if (event.type === "queued") queued++;
        if (event.type === "ingested") {
          ingested++;
          lines.push(
            event.result.skipped
              ? `• ${event.result.title}: unchanged, skipped`
              : `✓ ${event.result.title}: +${event.result.nodesCreated} entities, +${event.result.edgesCreated} relationships`,
          );
          if (progressToken) {
            void extra.sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: ingested,
                total: queued,
                message: `Ingesting ${event.file.split("/").pop()} (${ingested}/${queued})`,
              },
            });
          }
        }
        if (event.type === "error") lines.push(`✗ ${event.file}: ${event.error}`);
      });
      try {
        await w.add(dir);
        await w.idle();
      } finally {
        deps.setProgressSink(undefined);
      }
      lines.push(
        `\nWatching ${dir} — new and edited files will be ingested automatically while this session lives.`,
      );
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.registerTool(
    "context_unwatch_dir",
    {
      title: "Stop watching a folder",
      description:
        "Stop auto-ingesting a folder and remove it from the watch registry. Knowledge already " +
        "learned from it stays in the graph.",
      inputSchema: {
        dir: z.string().describe("Absolute path of the watched folder to disconnect."),
      },
    },
    async ({ dir }) => {
      await peekWatcher()?.remove(dir);
      const removed = engine.removeWatchedDir(dir);
      return {
        content: [
          {
            type: "text",
            text: removed
              ? `Stopped watching ${dir}. Its knowledge remains in the graph.`
              : `${dir} was not being watched.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "context_watch_status",
    {
      title: "Watched folders",
      description:
        "List folders connected for auto-watching: registered folders, which are live in this session, and the ingest queue size.",
      inputSchema: {},
    },
    async () => {
      const registered = engine.listWatchedDirs();
      const w = peekWatcher();
      const live = new Set(w?.dirs() ?? []);
      if (registered.length === 0 && live.size === 0) {
        return {
          content: [
            { type: "text", text: "No watched folders. Connect one with context_watch_dir." },
          ],
        };
      }
      const lines = registered.map(
        (wd) => `${live.has(wd.dir) ? "● live" : "○ registered"}  ${wd.dir}`,
      );
      for (const dir of live) {
        if (!registered.some((wd) => wd.dir === dir)) lines.push(`● live (unregistered)  ${dir}`);
      }
      const pending = w?.pendingCount() ?? 0;
      if (pending > 0) lines.push(`\n${pending} file(s) queued for ingestion.`);
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

  return server;
}

/** Standalone `context-graph-mcp` (stdio) entry point. */
async function main(): Promise<void> {
  const engine = new ContextGraphEngine();

  // One lazily-created watcher for the life of this MCP process. Folders added
  // via context_watch_dir keep updating the graph in the background for as long
  // as the client session (and thus this process) lives.
  let watcher: GraphWatcher | undefined;
  let progressSink: ((event: WatchEvent) => void) | undefined;
  const getWatcher = (): GraphWatcher =>
    (watcher ??= new GraphWatcher(engine, {
      onEvent: (event) => {
        // stderr only — stdout is the JSON-RPC channel.
        if (event.type === "error") console.error(`watch: ✗ ${event.file}: ${event.error}`);
        else if (event.type === "ingested" && !event.result.skipped) {
          console.error(`watch: ✓ ${event.result.title} (+${event.result.nodesCreated} entities)`);
        }
        progressSink?.(event);
      },
    }));

  const server = createContextGraphMcpServer({
    engine,
    getWatcher,
    peekWatcher: () => watcher,
    setProgressSink: (sink) => {
      progressSink = sink;
    },
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so we don't corrupt the stdio JSON-RPC channel.
  console.error("context-graph-engine MCP server running on stdio");

  // Opt-in: resume registered folders in the background. Off by default —
  // every client session spawns its own MCP process, and silent LLM spend on
  // file saves should be something the user chose.
  if (process.env.CONTEXT_GRAPH_AUTOWATCH === "1") {
    const dirs = engine.listWatchedDirs();
    if (dirs.length > 0) {
      const w = getWatcher();
      for (const wd of dirs) {
        w.add(wd.dir).catch((err) =>
          console.error(`watch: ✗ ${wd.dir}: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
      console.error(`auto-watching ${dirs.length} registered folder(s)`);
    }
  }
}

// Run the stdio server only when invoked directly (as the `context-graph-mcp`
// bin), not when imported by `serve`.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
