#!/usr/bin/env node
/**
 * `context-graph serve` — the whole engine in one process on one port.
 *
 * Runs a single {@link ContextGraphEngine}, a single {@link GraphWatcher}, the
 * web UI, and the MCP server (over Streamable HTTP) together. This is the
 * supported way to run everything at once: because there is exactly one engine
 * and one watcher, it sidesteps the "one watcher per db" footgun you hit when
 * running `context-graph-web` and a `context-graph watch` daemon side by side
 * (concurrent writers whose merges aren't transactional).
 *
 * Routing on the single HTTP server:
 *   - `/mcp`         → MCP over Streamable HTTP (POST to call, GET to stream)
 *   - everything else → the web UI + `/api/*` (see {@link createWebApp})
 *
 * Env mirrors `context-graph-web`: CONTEXT_GRAPH_DB, PORT (4680), HOST
 * (127.0.0.1), CONTEXT_GRAPH_WEB_TOKEN (also gates `/mcp` when exposed).
 */
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ContextGraphEngine } from "./engine.js";
import { GraphWatcher, type WatchEvent } from "./watch.js";
import { resolveConfig, type EngineConfig } from "./ai/providers.js";
import { createWebApp } from "./web.js";
import { createContextGraphMcpServer } from "./mcp.js";

export interface ServeOptions {
  /** Host to bind (default 127.0.0.1; a token guards /api and /mcp when non-loopback). */
  host?: string;
  /** Port to bind (default 4680; 0 picks a free port — handy for tests). */
  port?: number;
  /** Resume registered watch folders (and watch `dirs`) at startup. Default true. */
  watch?: boolean;
  /** Extra folders to register and watch, on top of the persisted registry. */
  dirs?: string[];
  /** Extensions the watcher ingests (default {@link DOC_EXTENSIONS}). */
  extensions?: string[];
  /** Engine config override (tests pass `:memory:` + fake providers here). */
  engineConfig?: EngineConfig;
  /** Provide an engine directly (tests); takes precedence over `engineConfig`. */
  engine?: ContextGraphEngine;
}

export interface RunningServer {
  /** Local URL the server is listening on. */
  url: string;
  /** The bound port (resolved even when `port: 0` was requested). */
  port: number;
  /** The shared engine, for tests/embedding. */
  engine: ContextGraphEngine;
  /** Stop everything: MCP transports, watcher, HTTP server, then the engine. */
  close: () => Promise<void>;
}

/** Read and JSON-parse a request body (for MCP POST bodies). */
function readJson(req: IncomingMessage, maxBytes = 50_000_000): Promise<unknown> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > maxBytes) rej(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        res(data ? JSON.parse(data) : undefined);
      } catch (e) {
        rej(e);
      }
    });
    req.on("error", rej);
  });
}

/**
 * Log a watcher event. A `default` branch deliberately swallows event types this
 * command doesn't know about, so a new {@link WatchEvent} variant (e.g. a
 * significance-skip added elsewhere) can never break `serve`.
 */
function logWatchEvent(event: WatchEvent): void {
  switch (event.type) {
    case "ingested":
      if (!event.result.skipped) {
        console.log(`watch: ✓ ${event.result.title} (+${event.result.nodesCreated} entities)`);
      }
      break;
    case "deleted": {
      const p = event.pruned;
      console.log(
        p
          ? `watch: • ${event.file} deleted (−${p.nodesRemoved} entities, −${p.edgesRemoved} relationships)`
          : `watch: • ${event.file} deleted`,
      );
      break;
    }
    case "error":
      console.error(`watch: ✗ ${event.file}: ${event.error}`);
      break;
    default:
      break;
  }
}

/**
 * Start the unified server. Resolves once it is listening; call the returned
 * {@link RunningServer.close} to shut it down.
 */
export async function startServe(opts: ServeOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? process.env.HOST ?? "127.0.0.1";
  const wantPort = opts.port ?? Number(process.env.PORT ?? 4680);
  const engineConfig = opts.engineConfig ?? {};
  const cfg = resolveConfig(engineConfig);
  const engine = opts.engine ?? new ContextGraphEngine(engineConfig);

  // One shared watcher. Its events are logged and also forwarded to whatever
  // MCP tool call is currently reporting catch-up progress.
  let currentProgressSink: ((event: WatchEvent) => void) | undefined;
  const watcher = new GraphWatcher(engine, {
    extensions: opts.extensions,
    onEvent: (event) => {
      logWatchEvent(event);
      currentProgressSink?.(event);
    },
  });

  const app = createWebApp({
    engine,
    cfg,
    host,
    port: wantPort,
    ensureWatcher: () => watcher,
    getWatcher: () => watcher,
  });

  // --- MCP over Streamable HTTP: one transport (and server) per client session ---
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Gate /mcp with the same bearer token the web /api uses when exposed.
    if (app.exposed && !app.isAuthorized(req)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "access token required" }));
      return;
    }

    const sid = req.headers["mcp-session-id"] as string | undefined;

    if (req.method === "POST") {
      const body = await readJson(req);
      let transport = sid ? transports[sid] : undefined;
      if (!transport) {
        // A new session must open with an `initialize` request and no session id.
        if (sid || !isInitializeRequest(body)) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32000, message: "Bad Request: no valid session" },
              id: null,
            }),
          );
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports[id] = transport!;
          },
        });
        transport.onclose = () => {
          const id = transport!.sessionId;
          if (id) delete transports[id];
        };
        const mcp = createContextGraphMcpServer({
          engine,
          getWatcher: () => watcher,
          peekWatcher: () => watcher,
          setProgressSink: (sink) => {
            currentProgressSink = sink;
          },
        });
        await mcp.connect(transport);
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    // GET (SSE stream) and DELETE (end session) require an established session.
    if (!sid || !transports[sid]) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "invalid or missing mcp-session-id" }));
      return;
    }
    await transports[sid].handleRequest(req, res);
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${wantPort}`);
    if (url.pathname === "/mcp") {
      void handleMcp(req, res).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
      return;
    }
    void app.handler(req, res);
  });

  // Resume registered watch folders (and any passed on the CLI) in the
  // background — the catch-up scan is a cheap hash-dedup pass for already-known
  // content, so we don't hold up listening on it.
  if (opts.watch !== false) {
    for (const d of opts.dirs ?? []) engine.addWatchedDir(d, opts.extensions);
    const registered = engine.listWatchedDirs();
    for (const wd of registered) {
      watcher.add(wd.dir).catch((err) =>
        console.error(`watch: ✗ ${wd.dir}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }

  await new Promise<void>((res) => server.listen(wantPort, host, res));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : wantPort;
  const url = `http://${host}:${port}`;

  const close = async (): Promise<void> => {
    for (const t of Object.values(transports)) {
      try {
        await t.close();
      } catch {
        /* ignore */
      }
    }
    await watcher.close();
    await new Promise<void>((res) => server.close(() => res()));
    await engine.close();
  };

  return { url, port, engine, close };
}

/** Standalone `context-graph-serve` entry point. */
async function main(): Promise<void> {
  const running = await startServe();
  const cfg = resolveConfig();
  const watchedCount = running.engine.listWatchedDirs().length;

  console.log(`Context Graph  →  ${running.url}`);
  console.log(`  web UI:      ${running.url}`);
  console.log(`  MCP (HTTP):  ${running.url}/mcp`);
  console.log(`  graph db:    ${resolve(cfg.dbPath)}`);
  console.log(
    `  extraction:  ${cfg.openrouterApiKey && !cfg.forceLocal ? `openrouter (${cfg.openrouterModel})` : `ollama (${cfg.ollamaModel})`}`,
  );
  console.log(`  embeddings:  ${cfg.openaiApiKey && !cfg.forceLocal ? "openai" : "local"}`);
  if (watchedCount > 0) console.log(`  watching:    ${watchedCount} registered folder(s)`);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nstopping…");
    await running.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
}

// Run only when invoked directly (the `context-graph-serve` bin / `serve` cmd).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
