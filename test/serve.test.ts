/**
 * The unified `context-graph serve` server: one process exposing the web UI,
 * the `/api/*` endpoints, and the MCP server over Streamable HTTP — all on one
 * port over a single shared engine. Runs fully offline on the fake providers.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ContextGraphEngine } from "../src/index.js";
import { startServe } from "../src/serve.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { fakeProviders } from "./helpers.ts";

test("serve exposes the web UI, /api, and MCP-over-HTTP on one port", async () => {
  const engine = new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
  await engine.ingest("[[Auth Service]] ==uses==> [[OAuth]]", { title: "auth", source: "auth.md" });

  // port 0 → a free port; watch:false so no folder resume in the test.
  const server = await startServe({ engine, host: "127.0.0.1", port: 0, watch: false });
  try {
    // 1) The web UI is served at the root.
    const home = await fetch(`${server.url}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /<!doctype html|<html/i);

    // 2) The JSON API works on the same port.
    const statsRes = await fetch(`${server.url}/api/stats`);
    assert.equal(statsRes.status, 200);
    const stats = (await statsRes.json()) as { documents: number; nodes: number };
    assert.ok(stats.documents >= 1, "ingested document is visible via /api/stats");

    // 3) MCP over Streamable HTTP: full handshake with the real SDK client.
    const client = new Client({ name: "serve-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`));
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    assert.ok(names.includes("context_read"), "context_read tool is exposed over HTTP");
    assert.ok(names.includes("context_contribute"), "context_contribute tool is exposed over HTTP");

    // The MCP server reads the SAME engine the web API saw.
    const read = (await client.callTool({
      name: "context_read",
      arguments: { query: "auth" },
    })) as { content: Array<{ type: string; text: string }> };
    const text = read.content.map((c) => c.text).join("\n");
    assert.match(text, /Auth Service|OAuth/i, "context_read returns the ingested entities");

    await client.close();
  } finally {
    await server.close();
  }
});

test("serve requires no token on loopback and 404s unknown paths", async () => {
  const engine = new ContextGraphEngine({ dbPath: ":memory:", ...fakeProviders() });
  const server = await startServe({ engine, host: "127.0.0.1", port: 0, watch: false });
  try {
    const missing = await fetch(`${server.url}/api/nope`);
    assert.equal(missing.status, 404);

    // A POST to /mcp that isn't an initialize (and carries no session) is a 400,
    // not a crash — proves the session guard is wired.
    const bad = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });
    assert.equal(bad.status, 400);
  } finally {
    await server.close();
  }
});
