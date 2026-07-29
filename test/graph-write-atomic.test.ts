/**
 * `wiring.json` must never be observable half-written.
 *
 * This stopped being theoretical when a query gained the ability to rebuild the
 * graph (`graph/refresh.ts`): the writer takes the build lock, but no reader does —
 * not the statusline's poll, not a second MCP call, not another graft process, not
 * `graft check` from the edit hook. A truncating write hands all of them a partial
 * document, and `readGraph` can only report that as null, i.e. "no graph — run
 * graft build" on a repo that has one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readGraph, wiringPath, writeGraph } from "../src/graph/write.js";
import type { GraphV1, NodeV1 } from "../src/graph/types.js";

/** A graph big enough that serializing it isn't instantaneous — the race window
 * has to be wide enough for a concurrent reader to land inside it. */
function graph(nodeCount: number, marker: string): GraphV1 {
  const nodes: NodeV1[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: `src/m${i}.ts#fn${i}`,
      name: `fn${i}`,
      kind: "function",
      path: `src/m${i}.ts`,
      start_line: 1,
      end_line: 3,
      signature: `function fn${i}(a: number): number`,
      body_hash: `${marker}${i}`,
      summary: null,
      summary_state: "pending",
      // Padding, so the file is megabytes rather than kilobytes.
      doc: `${marker} `.repeat(40),
    } as unknown as NodeV1);
  }
  return {
    meta: { version: 1, nodeCount, edgeCount: 0, languages: ["ts"], scopes: [] },
    nodes,
    edges: [],
  } as unknown as GraphV1;
}

function outDir(): string {
  return join(mkdtempSync(join(tmpdir(), "graft-atomic-")), "graft");
}

test("writeGraph replaces the file instead of truncating it in place", () => {
  const out = outDir();
  writeGraph(graph(50, "a"), out);
  const path = wiringPath(out);
  const before = statSync(path).ino;

  writeGraph(graph(50, "b"), out);

  // A truncating `writeFileSync` keeps the same inode and empties it; a tmp+rename
  // installs a different one. This is the whole difference, and it needs no timing
  // to observe.
  assert.notEqual(statSync(path).ino, before, "the destination must be replaced, not modified in place");
  assert.equal(readGraph(path)?.nodes[0]?.body_hash, "b0");

  // And the scratch file must not be left lying around next to it.
  const strays = readdirSync(dirname(path)).filter((f) => f.includes(".tmp"));
  assert.deepEqual(strays, [], `left temp files behind: ${strays.join(", ")}`);
});

test("a reader holding the file open across a rewrite still reads a whole graph", () => {
  const out = outDir();
  writeGraph(graph(400, "a"), out);
  const path = wiringPath(out);
  const original = readFileSync(path, "utf8");

  // Exactly the statusline's position: it opened the file, and mid-read a query
  // rebuilt the graph underneath it.
  const fd = openSync(path, "r");
  try {
    const head = Buffer.alloc(64);
    readSync(fd, head, 0, 64, 0); // started reading...
    writeGraph(graph(400, "b"), out); // ...and the graph is rewritten now

    const size = statSync(path).size;
    const rest = Buffer.alloc(original.length);
    const n = readSync(fd, rest, 0, original.length, 0);
    const seen = rest.subarray(0, n).toString("utf8");

    // The open handle keeps the file it opened: complete, parseable, and the
    // version it started with. Under a truncating write this read would return the
    // new file's bytes at old offsets — a spliced document that parses to nothing.
    assert.equal(seen, original, "the reader must see the whole document it opened");
    assert.equal(JSON.parse(seen).nodes[0].body_hash, "a0");
    assert.ok(size > 0, "and the new file is fully on disk for the next reader");
    assert.equal(readGraph(path)?.nodes[0]?.body_hash, "b0");
  } finally {
    closeSync(fd);
  }
});

test("a concurrent reader never parses a torn graph", async () => {
  const out = outDir();
  writeGraph(graph(3000, "a"), out);
  const path = wiringPath(out);
  const bytes = statSync(path).size;
  assert.ok(bytes > 1_000_000, `fixture should be megabytes to widen the window, got ${bytes}`);

  // A separate process, because writes here are synchronous — nothing in this
  // process could observe a partial file even if one existed.
  const READ_MS = 600;
  const reader = spawn(
    process.execPath,
    [
      "-e",
      `const fs = require("fs");
       let ok = 0, bad = 0, empty = 0;
       const end = Date.now() + ${READ_MS};
       while (Date.now() < end) {
         let text;
         try { text = fs.readFileSync(process.argv[1], "utf8"); } catch { bad++; continue; }
         if (text.length === 0) { empty++; continue; }
         try { JSON.parse(text); ok++; } catch { bad++; }
       }
       process.stdout.write(JSON.stringify({ ok, bad, empty }));`,
      path,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  let stdout = "";
  reader.stdout.setEncoding("utf8");
  reader.stdout.on("data", (c: string) => (stdout += c));

  // Rewrite continuously for as long as it's reading.
  const deadline = Date.now() + READ_MS;
  let writes = 0;
  while (Date.now() < deadline) {
    writeGraph(graph(3000, writes % 2 === 0 ? "a" : "b"), out);
    writes++;
  }

  await new Promise<void>((resolve) => reader.on("close", () => resolve()));
  const r = JSON.parse(stdout) as { ok: number; bad: number; empty: number };

  assert.ok(writes > 1, `the writer should have rewritten the file repeatedly, did ${writes}`);
  assert.ok(r.ok > 0, `the reader should have read it repeatedly, got ${JSON.stringify(r)}`);
  assert.equal(r.empty, 0, "no reader may ever see a zero-length graph");
  assert.equal(r.bad, 0, `every read must parse; got ${JSON.stringify(r)} across ${writes} writes`);
});
