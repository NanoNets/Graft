/**
 * `LspClient` end to end, against the fake server in `./lsp-enrich-server.mjs`.
 *
 * Until now nothing imported `src/graph/lsp/client.ts` at all: the spawn, the
 * initialize handshake, didOpen, the call-hierarchy pair, the per-request timeout
 * and the teardown were 177 unexecuted lines on every platform. `lsp-enrich.test.ts`
 * only ever asserted the degradation path (no server installed → no-op), which is
 * precisely the path a broken client is indistinguishable from — the whole tier was
 * dead on Windows and looked exactly like "you have no language server".
 *
 * No toolchain is installed for any of this: the fake server is plain Node speaking
 * the wire protocol, so both CI legs run the same tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { LspClient } from "../src/graph/lsp/client.js";
import { tmpRepo } from "./helpers.js";

const FAKE_SERVER = fileURLToPath(new URL("./lsp-enrich-server.mjs", import.meta.url));

/** A scratch repo with one source file, since didOpen reads from disk. */
function repoWithFile(): { root: string; file: string } {
  const root = tmpRepo("lsp-client");
  const file = join(root, "main.ts");
  writeFileSync(file, "export function caller() {\n  callee();\n}\n\nexport function callee() {}\n");
  return { root, file };
}

function clientFor(root: string, mode = "full", callTimeoutMs = 5000): LspClient {
  return new LspClient(process.execPath, [FAKE_SERVER, mode], root, "typescript", callTimeoutMs);
}

test("initialize → didOpen → call hierarchy → outgoing calls, over real stdio framing", async () => {
  const { root, file } = repoWithFile();
  const client = clientFor(root);
  try {
    assert.equal(await client.initialize(), true, "handshake completed");

    client.didOpen(file);
    const items = await client.prepareCallHierarchy(file, { line: 0, character: 16 });
    assert.equal(items.length, 1);
    // The server reports how many didOpen notifications it saw. Without it a client
    // that never sent one would look identical here — and servers answer call
    // hierarchy on an unopened document with silence, not an error.
    assert.equal(items[0].name, "caller/opened:1", "the document was opened before it was queried");
    assert.equal(items[0].uri, pathToFileURL(file).toString());

    const callees = await client.outgoingCalls(items[0]);
    assert.equal(callees.length, 1);
    assert.equal(callees[0].name, "callee");
    // `enrich.ts` maps a callee back to a graft node through this line number, so
    // the field it actually reads has to survive the round trip.
    assert.equal(callees[0].selectionRange.start.line, 4);
  } finally {
    await client.dispose();
  }
});

test("didOpen is idempotent — one notification per document, however often it is called", async () => {
  const { root, file } = repoWithFile();
  const client = clientFor(root);
  try {
    await client.initialize();
    // `enrichWithLsp` calls didOpen once per source node, so a file with twenty
    // functions would otherwise re-send its whole text twenty times.
    for (let i = 0; i < 5; i++) client.didOpen(file);
    const items = await client.prepareCallHierarchy(file, { line: 0, character: 16 });
    assert.equal(items[0].name, "caller/opened:1");
  } finally {
    await client.dispose();
  }
});

test("a request a server never answers ends at the timeout, not at the build's expense", async () => {
  const { root, file } = repoWithFile();
  const client = clientFor(root, "silent", 300);
  try {
    assert.equal(await client.initialize(), true);
    const started = Date.now();
    assert.deepEqual(await client.prepareCallHierarchy(file, { line: 0, character: 16 }), []);
    // The point of the timeout: a wedged server degrades the enrichment, it does
    // not hang `graft build --lsp` forever.
    assert.ok(Date.now() - started < 5000, "returned on the per-call timeout");
  } finally {
    await client.dispose();
  }
});

test("a server that never completes the handshake fails initialize instead of hanging", async () => {
  const { root } = repoWithFile();
  const client = clientFor(root, "deaf", 300);
  try {
    // `initialize` has its own 120s ceiling for cold indexing, so this leans on the
    // client noticing the process is gone. Kill it and the exit handler must flip
    // `ready` off — otherwise the whole build waits out two minutes for nothing.
    const done = client.initialize();
    await client.dispose();
    assert.equal(await done, false);
  } finally {
    await client.dispose();
  }
});

test("a command that does not exist degrades to 'no enrichment', never a crash", async () => {
  const { root } = repoWithFile();
  // The contract `enrichWithLsp` relies on: a registry entry pointing at something
  // unspawnable returns false fast, and the AST graph stands on its own.
  const client = new LspClient(join(root, "definitely-not-a-language-server"), [], root, "typescript", 300);
  try {
    assert.equal(await client.initialize(), false);
    assert.deepEqual(await client.prepareCallHierarchy(join(root, "main.ts"), { line: 0, character: 0 }), []);
  } finally {
    await client.dispose();
  }
});

test("a .cmd shim is spawnable (Windows npm-installed servers)", { skip: process.platform !== "win32" }, async () => {
  const { root, file } = repoWithFile();
  // `typescript-language-server` and `pyright-langserver` install as `.cmd` shims.
  // Node cannot CreateProcess one (EINVAL since the CVE-2024-27980 patch), so
  // handing the resolved path straight to `spawn` failed for every npm-installed
  // server on the platform — the exact servers a JS/TS repo would have.
  const shim = join(root, "fake-lsp.cmd");
  writeFileSync(shim, `@echo off\r\n"${process.execPath}" "${FAKE_SERVER}" full\r\n`);
  const client = new LspClient(shim, [], root, "typescript", 5000);
  try {
    assert.equal(await client.initialize(), true, "the shim spoke LSP through cmd.exe");
    client.didOpen(file);
    const items = await client.prepareCallHierarchy(file, { line: 0, character: 16 });
    assert.equal(items.length, 1);
  } finally {
    await client.dispose();
  }
});
