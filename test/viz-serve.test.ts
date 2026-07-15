/**
 * Tests for the viz server: endpoint shapes, code-graph gating, port fallback,
 * and SSE live-reload on context-dir changes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { startVizServer } from "../src/viz/serve.js";

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

    const graph = await fetch(`${srv.url}/api/context-graph`).then((r) => r.json());
    assert.equal(graph.meta.nodeCount, 1);
    assert.equal(graph.meta.repoName, "fixture");
    assert.equal(graph.nodes[0].id, "alpha");

    // no graph.json yet → 404 with an explanatory error
    const missing = await fetch(`${srv.url}/api/code-graph`);
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.match(body.error, /graft graph/);

    // valid graph.json → passthrough
    writeFileSync(
      join(contextDir, "graph.json"),
      JSON.stringify({ meta: { version: 1, nodeCount: 0, edgeCount: 0, languages: [] }, nodes: [], edges: [] }),
    );
    const code = await fetch(`${srv.url}/api/code-graph`).then((r) => r.json());
    assert.equal(code.meta.version, 1);
  } finally {
    await srv.close();
    rmSync(root, { recursive: true, force: true });
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
    rmSync(root, { recursive: true, force: true });
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
    rmSync(root, { recursive: true, force: true });
  }
});
