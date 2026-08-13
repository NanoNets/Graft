/**
 * A fake language server, for `test/lsp-enrich-client.test.ts`.
 *
 * `src/graph/lsp/client.ts` — spawn, initialize handshake, didOpen, call hierarchy,
 * timeouts, teardown — was executed by no test on any platform, which is how it kept
 * a Windows-only spawn bug and how the registry above it stayed broken unnoticed.
 * Standing up a real language server in CI is not an option (each one drags in a
 * whole toolchain), so this speaks the wire protocol directly: LSP is JSON-RPC over
 * stdio with `Content-Length` framing, and that is small enough to hand-roll.
 *
 * Deliberately dependency-free — no `vscode-jsonrpc` import — so it can be launched
 * from anywhere, including through a `.cmd` shim in a scratch directory, which is
 * exactly the case the Windows bug lived in.
 *
 * Modes (argv[2]):
 *   full   — answers everything (the happy path)
 *   silent — completes `initialize`, then never answers a request again, so the
 *            client's per-call timeout is what has to end the call
 *   deaf   — never answers anything, not even `initialize`
 */
const mode = process.argv[2] ?? "full";

/** Documents the client has opened, reported back so the test can see didOpen landed. */
const opened = [];

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  drain();
});

function drain() {
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep === -1) return;
    const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString("ascii"));
    if (!m) {
      buf = buf.subarray(sep + 4);
      continue;
    }
    const start = sep + 4;
    const len = Number(m[1]);
    if (buf.length < start + len) return; // body still arriving
    const body = buf.subarray(start, start + len).toString("utf8");
    buf = buf.subarray(start + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    handle(msg);
  }
}

function send(id, result) {
  const json = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, result }), "utf8");
  process.stdout.write(`Content-Length: ${json.length}\r\n\r\n`);
  process.stdout.write(json);
}

const range = (line) => ({ start: { line, character: 0 }, end: { line, character: 10 } });

function handle(msg) {
  if (mode === "deaf") return;
  if (msg.id === undefined) {
    if (msg.method === "textDocument/didOpen") opened.push(msg.params.textDocument.uri);
    return; // every other notification is noise we are allowed to drop
  }
  if (msg.method === "initialize") {
    send(msg.id, { capabilities: { textDocumentSync: 1, callHierarchyProvider: true } });
    return;
  }
  if (mode === "silent") return;
  switch (msg.method) {
    case "textDocument/prepareCallHierarchy": {
      const uri = msg.params.textDocument.uri;
      // The name carries the didOpen count: the client has no way to ask, and a
      // request that silently skipped didOpen would otherwise look identical.
      send(msg.id, [{ name: `caller/opened:${opened.length}`, kind: 12, uri, range: range(0), selectionRange: range(0) }]);
      return;
    }
    case "callHierarchy/outgoingCalls": {
      const uri = msg.params.item.uri;
      send(msg.id, [
        { to: { name: "callee", kind: 12, uri, range: range(4), selectionRange: range(4) }, fromRanges: [] },
      ]);
      return;
    }
    default:
      send(msg.id, null);
  }
}
