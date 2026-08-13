/**
 * Tests for the viz server: endpoint shapes, code-graph gating, port fallback,
 * and SSE live-reload on context-dir changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, request } from "node:http";
import { startVizServer } from "../src/viz/serve.js";
import { rmDir } from "./helpers.js";
import type { VizGraph } from "../src/viz/assemble.js";
import type { GraphV1 } from "../src/graph/types.js";

/** `Response.json()` is typed `unknown`, so every field read below would otherwise
 * be unchecked. Naming each endpoint's payload with the type the server actually
 * builds it from means a drifting response fails the type check instead of quietly
 * asserting against `undefined`. */
type ContextGraphBody = VizGraph & { meta: VizGraph["meta"] & { repoName: string } };
type ErrorBody = { error: string };

/** A raw request with an arbitrary `Host`. `fetch` can't do this — `Host` is a
 * forbidden header name there and undici silently drops it — but a browser
 * under DNS rebinding sends exactly this: the attacker's hostname, on a socket
 * connected to 127.0.0.1. */
function getWithHost(port: number, path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

function makeDirs(): { contextDir: string; viewerDir: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), "graftviz-srv-"));
  const contextDir = join(root, ".context");
  const viewerDir = join(root, "viewer");
  mkdirSync(contextDir);
  mkdirSync(viewerDir);
  writeFileSync(join(viewerDir, "index.html"), "<title>stub</title>\n");
  writeFileSync(join(viewerDir, "app.js"), "// stub\n");
  writeFileSync(join(viewerDir, "style.css"), "/* stub */\n");
  writeFileSync(
    join(contextDir, "alpha.md"),
    `---\nname: Alpha\nslug: alpha\ntype: system\nsources: []\nlinks: []\n---\nbody\n`,
  );
  return { contextDir, viewerDir, root };
}

test("viz server serves viewer, context graph, and gates code graph", async () => {
  const { contextDir, viewerDir, root } = makeDirs();
  const srv = await startVizServer({ contextDir, viewerDir, port: 4831, repoName: "fixture" });
  try {
    const html = await fetch(`${srv.url}/`).then((r) => r.text());
    assert.match(html, /stub/);

    const graph = (await fetch(`${srv.url}/api/context-graph`).then((r) => r.json())) as ContextGraphBody;
    assert.equal(graph.meta.nodeCount, 1);
    assert.equal(graph.meta.repoName, "fixture");
    assert.equal(graph.nodes[0].id, "alpha");

    // no wiring graph yet → 404 with an explanatory error
    const missing = await fetch(`${srv.url}/api/code-graph`);
    assert.equal(missing.status, 404);
    const body = (await missing.json()) as ErrorBody;
    assert.match(body.error, /graft build/);

    // valid wiring graph → passthrough
    mkdirSync(join(contextDir, ".graph"), { recursive: true });
    writeFileSync(
      join(contextDir, ".graph", "wiring.json"),
      JSON.stringify({ meta: { version: 1, nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }),
    );
    const code = (await fetch(`${srv.url}/api/code-graph`).then((r) => r.json())) as GraphV1;
    assert.equal(code.meta.version, 1);
  } finally {
    await srv.close();
    rmDir(root);
  }
});

test("viz server falls back to the next free port", async () => {
  const { contextDir, viewerDir, root } = makeDirs();
  const blocker = createServer(() => {});
  await new Promise<void>((res) => blocker.listen(4841, "127.0.0.1", res));
  const srv = await startVizServer({ contextDir, viewerDir, port: 4841, repoName: "fixture" });
  try {
    assert.match(srv.url, /:4842$/);
  } finally {
    await srv.close();
    await new Promise((res) => blocker.close(res));
    rmDir(root);
  }
});

test("viz server rejects a foreign Host header (DNS rebinding) on every route", async () => {
  const { contextDir, viewerDir, root } = makeDirs();
  mkdirSync(join(contextDir, ".graph"), { recursive: true });
  writeFileSync(
    join(contextDir, ".graph", "wiring.json"),
    JSON.stringify({ meta: { version: 1, nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }),
  );
  const srv = await startVizServer({ contextDir, viewerDir, port: 4861, repoName: "fixture" });
  try {
    // A page on attacker.example that rebinds its own hostname to 127.0.0.1
    // reaches this port as same-origin — but the Host it sends is still its
    // own, and script cannot forge that header. Everything reachable must
    // refuse it, especially /api/code-graph (the entire private wiring graph).
    for (const path of ["/", "/app.js", "/api/context-graph", "/api/code-graph", "/events"]) {
      const res = await getWithHost(4861, path, "attacker.example");
      assert.equal(res.status, 403, `${path} must refuse a foreign Host`);
      assert.doesNotMatch(res.body, /nodeCount|wiring|stub/, `${path} must leak nothing in the refusal`);
    }
    // A right-hostname-wrong-port Host is still a rebind attempt, not a typo a
    // browser would produce on its own.
    assert.equal((await getWithHost(4861, "/api/code-graph", "127.0.0.1:9999")).status, 403);

    // The two names a human can actually have typed still work.
    for (const host of ["127.0.0.1:4861", "localhost:4861"]) {
      const res = await getWithHost(4861, "/api/context-graph", host);
      assert.equal(res.status, 200, `${host} must still be served`);
      assert.match(res.body, /nodeCount/);
    }
  } finally {
    await srv.close();
    rmDir(root);
  }
});

test("viz server emits an SSE event when the context dir changes", async () => {
  const { contextDir, viewerDir, root } = makeDirs();
  const srv = await startVizServer({ contextDir, viewerDir, port: 4851, repoName: "fixture" });
  try {
    const controller = new AbortController();
    const res = await fetch(`${srv.url}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    // trigger a change after the stream is open
    setTimeout(() => writeFileSync(join(contextDir, "alpha.md"), "---\nname: Alpha2\nslug: alpha\n---\n"), 150);
    const deadline = Date.now() + 5000;
    let seen = "";
    while (Date.now() < deadline && !seen.includes("data: change")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.match(seen, /data: change/);
  } finally {
    await srv.close();
    rmDir(root);
  }
});

test("viz server emits an SSE event when only .graph/wiring.json is rewritten", async () => {
  const { contextDir, viewerDir, root } = makeDirs();
  // Present BEFORE the server starts, which is the realistic case: `graft viz`
  // is run on an already-built repo, and the rebuild that follows may touch
  // nothing but the wiring graph.
  const graphDir = join(contextDir, ".graph");
  mkdirSync(graphDir, { recursive: true });
  const wiring = join(graphDir, "wiring.json");
  const payload = (n: number) =>
    JSON.stringify({ meta: { version: 1, nodeCount: n, edgeCount: 0, languages: [] }, nodes: [], edges: [] });
  writeFileSync(wiring, payload(0));

  const srv = await startVizServer({ contextDir, viewerDir, port: 4871, repoName: "fixture" });
  try {
    const controller = new AbortController();
    const res = await fetch(`${srv.url}/events`, {
      headers: { accept: "text/event-stream" },
      signal: controller.signal,
    });
    const reader = res.body!.getReader();
    // A graph-only refresh (the `--graph-only` rebuild the query path triggers)
    // writes here and nowhere else. A single non-recursive watch on contextDir
    // never sees it, so the Code graph tab silently went stale until F5.
    setTimeout(() => writeFileSync(wiring, payload(1)), 150);
    const deadline = Date.now() + 5000;
    let seen = "";
    while (Date.now() < deadline && !seen.includes("data: change")) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += new TextDecoder().decode(value);
    }
    controller.abort();
    assert.match(seen, /data: change/);
  } finally {
    await srv.close();
    rmDir(root);
  }
});
