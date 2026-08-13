/**
 * The `graft viz` local server. Zero runtime dependencies: node:http serves
 * the prebuilt viewer bundle, two JSON endpoints, and an SSE channel that
 * pings the browser whenever the context dir changes on disk.
 *
 *   GET /                  viewer (index.html, app.js, style.css from viewerDir)
 *   GET /api/context-graph assembled from .context/*.md on every request
 *   GET /api/code-graph    .context/graph.json passthrough (404 until generated)
 *   GET /events            SSE; fs.watch on the context dir + .graph/, debounced 300ms
 *
 * Every route is gated on the Host header first (see `hostAllowed`) — the
 * loopback bind alone does not keep a rebound browser out.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { readFileSync, existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { assembleContextGraph } from "./assemble.js";

export interface VizServerOptions {
  contextDir: string;
  viewerDir: string;
  port: number;
  repoName: string;
}

export interface VizServer {
  url: string;
  close(): Promise<void>;
}

const PORT_ATTEMPTS = 10;
const WATCH_DEBOUNCE_MS = 300;

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/index.html": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/style.css": { file: "style.css", type: "text/css; charset=utf-8" },
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Loopback bind keeps other machines out; it does NOT keep other *sites* out.
 * Any page the user happens to visit can point a hostname it controls at
 * 127.0.0.1 (DNS rebinding), and from then on the browser treats
 * `http://evil.example:PORT/api/code-graph` as same-origin and hands the
 * response back to the attacker's JS. That endpoint is the whole wiring graph
 * of a private repo — file paths, signatures, summaries, crux excerpts.
 *
 * The Host header is what defeats it: a rebound request still carries the
 * attacker's hostname, and the browser will not let script forge it. So only
 * the two names a human can actually have typed are accepted. A request with
 * no Host at all (HTTP/1.0, raw sockets) is refused too — nothing legitimate
 * reaches this server without one.
 */
function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

function listen(server: Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") resolve(false);
      else reject(err);
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve(true);
    });
  });
}

export async function startVizServer(opts: VizServerOptions): Promise<VizServer> {
  const sseClients = new Set<ServerResponse>();

  // Declared before the handler because the bound port isn't known until the
  // fallback loop below finishes, and `hostAllowed` has to compare against the
  // port the browser actually connected to.
  let port = opts.port;

  const server = createServer((req, res) => {
    if (!hostAllowed(req.headers.host, port)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden: unexpected Host header — open this server as http://127.0.0.1:" + port + "/");
      return;
    }
    const path = (req.url ?? "/").split("?")[0];

    const asset = STATIC_FILES[path];
    if (asset) {
      const file = join(opts.viewerDir, asset.file);
      if (!existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("viewer bundle missing — run the package build");
        return;
      }
      res.writeHead(200, { "content-type": asset.type });
      res.end(readFileSync(file));
      return;
    }

    if (path === "/api/context-graph") {
      const graph = assembleContextGraph(opts.contextDir);
      sendJson(res, 200, { ...graph, meta: { ...graph.meta, repoName: opts.repoName } });
      return;
    }

    if (path === "/api/code-graph") {
      const file = join(opts.contextDir, ".graph", "wiring.json");
      if (!existsSync(file)) {
        sendJson(res, 404, { error: "no wiring graph in this context dir — run `graft build` first" });
        return;
      }
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8"));
        if (parsed?.meta?.version !== 1) {
          sendJson(res, 404, { error: "wiring.json has an unsupported version — regenerate with `graft build`" });
          return;
        }
        sendJson(res, 200, parsed);
      } catch {
        sendJson(res, 404, { error: "wiring.json is unreadable — regenerate with `graft build`" });
      }
      return;
    }

    if (path === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => sseClients.delete(res));
      return;
    }

    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  let bound = false;
  for (let i = 0; i < PORT_ATTEMPTS && !bound; i++) {
    port = opts.port + i;
    bound = await listen(server, port);
  }
  if (!bound) {
    throw new Error(`no free port in ${opts.port}–${opts.port + PORT_ATTEMPTS - 1}`);
  }

  const watchers: FSWatcher[] = [];
  let debounce: NodeJS.Timeout | undefined;
  const notify = (): void => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      for (const client of sseClients) client.write("data: change\n\n");
    }, WATCH_DEBOUNCE_MS);
  };
  // TWO non-recursive watchers, not one recursive one. `wiring.json` lives in
  // `<contextDir>/.graph/`, and a non-recursive watch on the parent never sees
  // it — so a graph-only rebuild (the `--graph-only` refresh the query path
  // triggers) left the Code graph tab stale until the user pressed F5, while a
  // `--deep` build rewrote the `.md` cards in contextDir itself and therefore
  // appeared to work. `{ recursive: true }` is the obvious fix and the wrong
  // one: on Linux it only exists from Node 20.13 and throws
  // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM below that, while package.json promises
  // node >= 20. Two flat watchers work identically on every supported version.
  if (existsSync(opts.contextDir)) {
    watchers.push(watch(opts.contextDir, notify));
    const graphDir = join(opts.contextDir, ".graph");
    // Missing at startup on a repo built without a wiring graph; a later build
    // creating .graph/ writes into contextDir too, so the parent watcher still
    // fires for that first appearance.
    if (existsSync(graphDir)) watchers.push(watch(graphDir, notify));
  }

  return {
    url: `http://127.0.0.1:${port}`,
    close(): Promise<void> {
      clearTimeout(debounce);
      for (const w of watchers) w.close();
      for (const client of sseClients) client.end();
      sseClients.clear();
      return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
