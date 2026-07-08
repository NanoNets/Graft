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
import { readFileSync, existsSync, statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import OpenAI from "openai";
import { ContextGraphEngine } from "./engine.js";
import { resolveConfig } from "./ai/providers.js";

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

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000_000) rej(new Error("body too large"));
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
 * Access token for the API. On the loopback default no token is needed — the
 * OS already gates who can reach the port. The moment the server is exposed
 * beyond loopback (HOST=0.0.0.0, Docker, a VPS) a token is required: taken
 * from CONTEXT_GRAPH_WEB_TOKEN, or generated fresh and printed at startup.
 */
const EXPOSED = !LOCAL_HOSTNAMES.has(HOST);
const WEB_TOKEN =
  process.env.CONTEXT_GRAPH_WEB_TOKEN?.trim() ||
  (EXPOSED ? randomBytes(18).toString("base64url") : undefined);

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
      const { dir } = JSON.parse(await readBody(req)) as { dir?: string };
      if (!dir?.trim()) return json(res, 400, { error: "dir is required" });
      const abs = resolve(dir);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        return json(res, 400, { error: `not a directory: ${abs}` });
      }

      // Stream progress as NDJSON so the UI can narrate a long ingest live.
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const emit = (event: unknown) => res.write(JSON.stringify(event) + "\n");
      try {
        const results = await engine.ingestDir(abs, {
          onProgress: (info) => emit({ type: "progress", ...info }),
        });
        emit({ type: "done", results, stats: await engine.stats() });
      } catch (e) {
        emit({ type: "error", error: e instanceof Error ? e.message : String(e) });
      }
      res.end();
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

server.listen(PORT, HOST, () => {
  const p = providerStatus();
  console.log(`Context Graph web UI  →  http://localhost:${PORT}`);
  if (EXPOSED && WEB_TOKEN) {
    const lan = lanAddress();
    console.log(`  access token: ${WEB_TOKEN}`);
    if (lan) console.log(`  share with your team:  http://${lan}:${PORT}/?token=${WEB_TOKEN}`);
    else console.log(`  share:  http://<this-machine>:${PORT}/?token=${WEB_TOKEN}`);
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
