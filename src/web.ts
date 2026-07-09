#!/usr/bin/env node
/**
 * `context-graph-web` — the Team Brain web UI.
 *
 * A zero-dependency HTTP server (node:http) over the ContextGraphEngine:
 * ask questions with cited, confidence-scored answers; watch the graph grow
 * as documents are ingested; contribute learnings back. Serves a single
 * self-contained page from ./web/ui.html.
 *
 * Env: CONTEXT_GRAPH_DB (graph file), PORT (default 4680),
 *      HOST (default 127.0.0.1 — set 0.0.0.0 to expose on a network, e.g. Docker),
 *      CONTEXT_GRAPH_WEB_TOKEN (access token for /api; auto-generated and
 *      printed at startup whenever the server is exposed beyond loopback),
 *      OPENROUTER_API_KEY (optional — enables synthesized answers + ingest
 *      extraction; without it retrieval and the graph view stay fully local).
 */
import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve, dirname, join } from "node:path";
import OpenAI from "openai";
import { ContextGraphEngine } from "./engine.js";
import { GraphWatcher } from "./watch.js";
import { resolveConfig } from "./ai/providers.js";
import { extractPdfTextFromData, isPdfPath } from "./ingest/pdf.js";

const PORT = Number(process.env.PORT ?? 4680);
const HOST = process.env.HOST ?? "127.0.0.1";
const engine = new ContextGraphEngine();
const cfg = resolveConfig();

const uiPath = new URL("./web/ui.html", import.meta.url);

/** Which extraction/answer provider is live, so the UI can say so honestly. */
function providerStatus() {
  return {
    extraction: cfg.openrouterApiKey && !cfg.forceLocal ? "openrouter" : "ollama",
    embeddings: cfg.openaiApiKey && !cfg.forceLocal ? "openai" : "local",
    canSynthesize: Boolean(cfg.openrouterApiKey && !cfg.forceLocal),
    model: cfg.openrouterApiKey ? cfg.openrouterModel : cfg.ollamaModel,
    db: resolve(cfg.dbPath),
  };
}

/** Synthesize a grounded natural-language answer from a retrieval bundle. */
async function synthesizeAnswer(
  question: string,
  prompt: string,
  sourceTitles: string[],
): Promise<string> {
  const client = new OpenAI({
    apiKey: cfg.openrouterApiKey,
    baseURL: cfg.openrouterBaseUrl,
    defaultHeaders: { "X-Title": "Context Graph Web" },
  });
  const response = await client.chat.completions.create({
    model: cfg.openrouterModel,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You answer questions using ONLY the provided context from a team knowledge graph. " +
          "Be direct and specific. Cite sources inline with bracketed numbers like [1], [2] " +
          "matching the numbered source list. If the context does not contain the answer, say " +
          "exactly what is missing — never invent facts.",
      },
      {
        role: "user",
        content: `${prompt}\n\n## Numbered sources\n${sourceTitles
          .map((t, i) => `[${i + 1}] ${t}`)
          .join("\n")}\n\n## Question\n${question}`,
      },
    ],
  });
  return response.choices[0]?.message?.content ?? "";
}

function readBody(req: IncomingMessage, maxBytes = 10_000_000): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > maxBytes) rej(new Error("body too large"));
    });
    req.on("end", () => res(data));
    req.on("error", rej);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Directory that holds durable server state (the graph db, and the persisted
 * access token). Defaults next to the SQLite file so it rides the same mounted
 * volume in Docker. Undefined for an in-memory db — nothing to persist.
 */
function dataDir(): string | undefined {
  if (cfg.dbPath === ":memory:") return undefined;
  return dirname(resolve(cfg.dbPath));
}

/**
 * Resolve the access token, persisting a generated one so it survives restarts.
 *
 * Precedence: an explicit CONTEXT_GRAPH_WEB_TOKEN always wins (and is never
 * written to disk). Otherwise, when exposed, reuse a previously persisted token
 * or mint one and save it (owner-only) beside the db — so a `docker compose
 * restart` no longer invalidates every teammate's saved link. Also drops a
 * human-readable share-link.txt so the deployer never has to grep the logs.
 */
function resolveWebToken(): { token?: string; sharePath?: string } {
  const explicit = process.env.CONTEXT_GRAPH_WEB_TOKEN?.trim();
  if (explicit) return { token: explicit };
  if (!EXPOSED) return {};

  const dir = dataDir();
  if (!dir) return { token: randomBytes(18).toString("base64url") };

  const tokenPath = join(dir, ".web-token");
  let token: string;
  try {
    token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "";
    if (!token) {
      token = randomBytes(18).toString("base64url");
      mkdirSync(dir, { recursive: true });
      writeFileSync(tokenPath, token + "\n", { mode: 0o600 });
    }
  } catch {
    // Read-only volume or similar — fall back to an in-memory token so the
    // server still starts (it'll just change on restart, as before).
    return { token: randomBytes(18).toString("base64url") };
  }

  // Best-effort human-readable share file; failure here must not block startup.
  let sharePath: string | undefined;
  try {
    const lan = lanAddress();
    const base = lan ? `http://${lan}:${PORT}` : `http://<this-machine>:${PORT}`;
    const share = join(dir, "share-link.txt");
    writeFileSync(
      share,
      `Context Graph — team access\n\n` +
        `Access token:\n  ${token}\n\n` +
        `Share this link with your team (opens the UI already signed in):\n  ${base}/#token=${token}\n\n` +
        `On this machine, use:\n  http://localhost:${PORT}/#token=${token}\n`,
      { mode: 0o600 },
    );
    sharePath = share;
  } catch {
    /* ignore */
  }
  return { token, sharePath };
}

/**
 * Access token for the API. On the loopback default no token is needed — the
 * OS already gates who can reach the port. The moment the server is exposed
 * beyond loopback (HOST=0.0.0.0, Docker, a VPS) a token is required: taken
 * from CONTEXT_GRAPH_WEB_TOKEN, or persisted next to the db and printed at
 * startup (see resolveWebToken).
 */
const EXPOSED = !LOCAL_HOSTNAMES.has(HOST);
const { token: WEB_TOKEN, sharePath: SHARE_PATH } = resolveWebToken();

function isAuthorized(req: IncomingMessage): boolean {
  if (!WEB_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Hash both sides so timingSafeEqual gets equal-length buffers.
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(WEB_TOKEN).digest();
  return timingSafeEqual(a, b);
}

/** Best-guess LAN address, to print a ready-to-share URL at startup. */
function lanAddress(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
  return undefined;
}

function hostnameOf(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  try {
    return new URL(
      headerValue.includes("://") ? headerValue : `http://${headerValue}`,
    ).hostname;
  } catch {
    return undefined;
  }
}

/**
 * Browser-facing hardening for a loopback server: a malicious webpage must not
 * be able to drive state-changing endpoints (CSRF) or read responses via DNS
 * rebinding. When HOST is loopback (the default), only localhost Host headers
 * are accepted; POSTs must be application/json and, if a browser sent an
 * Origin, it must be a localhost origin too.
 */
function rejectForeignRequest(req: IncomingMessage, res: ServerResponse): boolean {
  const boundToLoopback = LOCAL_HOSTNAMES.has(HOST);
  if (boundToLoopback) {
    const host = hostnameOf(req.headers.host);
    if (!host || !LOCAL_HOSTNAMES.has(host)) {
      json(res, 403, { error: "forbidden: unexpected Host header" });
      return true;
    }
  }
  if (req.method === "POST") {
    if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
      json(res, 415, { error: "content-type must be application/json" });
      return true;
    }
    const origin = hostnameOf(req.headers.origin);
    if (boundToLoopback && req.headers.origin && (!origin || !LOCAL_HOSTNAMES.has(origin))) {
      json(res, 403, { error: "forbidden: cross-origin request" });
      return true;
    }
  }
  return false;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  try {
    if (rejectForeignRequest(req, res)) return;
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      // The page itself is public — it holds no data. All data flows through
      // /api/*, which is what the token gates.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(uiPath, "utf8"));
      return;
    }

    if (url.pathname.startsWith("/api/") && !isAuthorized(req)) {
      return json(res, 401, { error: "access token required" });
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      json(res, 200, { ...(await engine.stats()), provider: providerStatus() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/graph") {
      json(res, 200, await engine.exportGraph());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/documents") {
      json(res, 200, await engine.store.allDocuments());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/watched") {
      json(res, 200, {
        registered: engine.listWatchedDirs(),
        live: webWatcher?.dirs() ?? [],
        pending: webWatcher?.pendingCount() ?? 0,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const { question } = JSON.parse(await readBody(req)) as { question?: string };
      if (!question?.trim()) return json(res, 400, { error: "question is required" });

      const bundle = await engine.read(question, { maxNodes: 8, maxChunks: 6 });
      let answer: string | null = null;
      if (providerStatus().canSynthesize && (bundle.nodes.length || bundle.chunks.length)) {
        try {
          answer = await synthesizeAnswer(
            question,
            bundle.prompt,
            bundle.chunks.map((c) => c.documentTitle),
          );
        } catch (e) {
          // Answer synthesis is an upgrade, not a requirement — degrade to the
          // structured bundle rather than failing the whole request.
          answer = null;
        }
      }
      json(res, 200, { answer, bundle });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ingest-dir") {
      // Accepts a directory or a single file on the server's disk. With
      // watch:true the directory is also registered and watched in-process,
      // so future edits keep flowing into the graph while the server runs.
      const { dir, extensions, watch } = JSON.parse(await readBody(req)) as {
        dir?: string;
        extensions?: string[];
        watch?: boolean;
      };
      if (!dir?.trim()) return json(res, 400, { error: "dir is required" });
      const abs = resolve(dir);
      if (!existsSync(abs)) {
        return json(res, 400, { error: `no such file or directory: ${abs}` });
      }
      const isDir = statSync(abs).isDirectory();

      // Stream progress as NDJSON so the UI can narrate a long ingest live.
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const emit = (event: unknown) => res.write(JSON.stringify(event) + "\n");
      try {
        const results = isDir
          ? await engine.ingestDir(abs, {
              extensions,
              onProgress: (info) => emit({ type: "progress", ...info }),
            })
          : [await engine.ingestFile(abs)];
        let watching = false;
        if (watch && isDir) {
          engine.addWatchedDir(abs, extensions);
          // The just-finished ingest makes the watcher's catch-up scan a
          // pure hash-dedup pass — no LLM calls. Don't hold the response.
          void ensureWebWatcher()
            .add(abs)
            .catch((e) => console.error(`watch: ✗ ${abs}: ${e instanceof Error ? e.message : String(e)}`));
          watching = true;
        }
        emit({ type: "done", results, watching, stats: await engine.stats() });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
      }
      res.end();
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/ingest-upload") {
      // One uploaded file at a time (the browser folder picker can't hand us a
      // server path, so it ships file contents instead). Text files arrive as
      // `text`; PDFs and other binaries arrive base64-encoded in `dataBase64`.
      // `relPath` (folder/sub/file.md) keys the document when present, so two
      // same-named files in different folders don't replace each other and a
      // synced folder's re-uploads update the right document.
      // 60 MB cap leaves room for a large PDF plus base64's ~33% overhead.
      const { name, relPath, text, dataBase64 } = JSON.parse(await readBody(req, 60_000_000)) as {
        name?: string;
        relPath?: string;
        text?: string;
        dataBase64?: string;
      };
      if (!name?.trim()) return json(res, 400, { error: "name is required" });

      let content: string;
      if (isPdfPath(name)) {
        if (!dataBase64) return json(res, 400, { error: "PDF upload needs dataBase64" });
        content = await extractPdfTextFromData(new Uint8Array(Buffer.from(dataBase64, "base64")));
      } else {
        content = text ?? "";
      }
      if (!content.trim()) return json(res, 200, { skipped: true, name, empty: true });

      const result = await engine.ingest(content, {
        title: name,
        source: relPath?.trim() || name,
      });
      json(res, 200, { result, stats: await engine.stats() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/contribute") {
      const { learning, agentId } = JSON.parse(await readBody(req)) as {
        learning?: string;
        agentId?: string;
      };
      if (!learning?.trim()) return json(res, 400, { error: "learning is required" });
      const result = await engine.contribute(learning, { agentId: agentId || "web-user" });
      json(res, 200, { ...result, stats: await engine.stats() });
      return;
    }

    json(res, 404, { error: "not found" });
  } catch (e) {
    json(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
});

// In-process auto-watch. Created lazily: by CONTEXT_GRAPH_WATCH=1 at startup
// (resumes registered folders), or the first time the UI ingests a server
// path with "keep watching" enabled.
let webWatcher: GraphWatcher | undefined;

function ensureWebWatcher(): GraphWatcher {
  return (webWatcher ??= new GraphWatcher(engine, {
    onEvent: (event) => {
      if (event.type === "ingested" && !event.result.skipped) {
        console.log(`watch: ✓ ${event.result.title} (+${event.result.nodesCreated} entities)`);
      } else if (event.type === "deleted") {
        const p = event.pruned;
        const detail = p ? ` (pruned ${p.nodesRemoved} entities, ${p.edgesRemoved} relationships)` : "";
        console.log(`watch: • ${event.file} deleted${detail}`);
      } else if (event.type === "error") {
        console.error(`watch: ✗ ${event.file}: ${event.error}`);
      }
    },
  }));
}

if (process.env.CONTEXT_GRAPH_WATCH === "1") {
  const dirs = engine.listWatchedDirs();
  if (dirs.length > 0) {
    for (const wd of dirs) {
      ensureWebWatcher()
        .add(wd.dir)
        .catch((err) =>
          console.error(`watch: ✗ ${wd.dir}: ${err instanceof Error ? err.message : String(err)}`),
        );
    }
  } else {
    console.log("CONTEXT_GRAPH_WATCH=1 but no folders are registered — run: context-graph watch <dir>");
  }
}

server.listen(PORT, HOST, () => {
  const p = providerStatus();
  console.log(`Context Graph web UI  →  http://localhost:${PORT}`);
  if (EXPOSED && WEB_TOKEN) {
    const lan = lanAddress();
    console.log(`  access token: ${WEB_TOKEN}`);
    // Token travels in the URL *fragment*: browsers never send fragments over
    // the network, so it can't leak into proxy or access logs.
    if (lan) console.log(`  share with your team:  http://${lan}:${PORT}/#token=${WEB_TOKEN}`);
    else console.log(`  share:  http://<this-machine>:${PORT}/#token=${WEB_TOKEN}`);
    // The same link is written to a file on the mounted volume, so the deployer
    // (who ran `docker compose up -d` and sees no logs) can just open it.
    if (SHARE_PATH) console.log(`  share link also saved to:  ${SHARE_PATH}`);
  }
  console.log(`  graph db:    ${p.db}`);
  console.log(`  extraction:  ${p.extraction} (${p.model})`);
  console.log(`  embeddings:  ${p.embeddings}`);
  if (!p.canSynthesize) {
    console.log(
      "  note: no OPENROUTER_API_KEY — answers show structured context without LLM synthesis",
    );
  }
});
