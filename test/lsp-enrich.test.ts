/**
 * LSP enrichment tier: registry selection + graceful degradation. These run
 * without any language server installed — they assert the OPT-IN promise that
 * `graft build --lsp` is a safe no-op when no server applies (never a crash,
 * never a mutated graph), which is the contract the build relies on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { pickServer, resetResolvedCommands, LSP_SERVERS } from "../src/graph/lsp/registry.js";
import { enrichWithLsp } from "../src/graph/lsp/enrich.js";
import type { GraphV1 } from "../src/graph/types.js";
import { tmpRepo } from "./helpers.js";

test("pickServer: no languages present → no server", () => {
  assert.equal(pickServer(new Set()), null);
});

test("pickServer: a language no registered server covers → null", () => {
  assert.equal(pickServer(new Set(["cobol", "fortran"])), null);
});

test("registry rows are well-formed (languages, command, languageId)", () => {
  for (const s of LSP_SERVERS) {
    assert.ok(s.languages.length > 0 && s.command && s.languageId, `${s.command} row shape`);
    assert.ok(Array.isArray(s.args), `${s.command} args is an array`);
  }
});

// --- server resolution ---
//
// The lookup used to be `execSync("command -v <cmd>")`, a POSIX shell builtin. On
// Windows `cmd.exe` answers "'command' is not recognized" and throws, so every
// language resolved to null and `graft build --lsp` was a silent no-op across the
// platform — indistinguishable, from the outside, from "no server installed", which
// is all the tests above could tell you.

/** Install a fake `rust-analyzer` on PATH, and point PATH at only that. */
function stubServerDir(name: string): string {
  const dir = tmpRepo("lsp-registry");
  // Contents don't matter: resolution answers "where is it", and spawning it is
  // `client.ts`'s business (and its own test's).
  writeFileSync(join(dir, process.platform === "win32" ? `${name}.CMD` : name), "");
  return dir;
}

function withPath(dir: string, fn: () => void): void {
  const saved = process.env.PATH;
  process.env.PATH = dir;
  resetResolvedCommands();
  try {
    fn();
  } finally {
    process.env.PATH = saved;
    resetResolvedCommands();
  }
}

test("pickServer resolves a server on PATH to an absolute path (Windows: PATHEXT shims)", () => {
  const dir = stubServerDir("rust-analyzer");
  withPath(dir, () => {
    const picked = pickServer(new Set(["rust"]));
    assert.ok(picked, "rust-analyzer on PATH must be found");
    // Absolute, because `spawn` resolves against PATH again and the two can
    // disagree — resolving here is the point of the lookup.
    assert.ok(isAbsolute(picked!.command));
    assert.equal(picked!.languageId, "rust");
  });
});

test("pickServer honours registry priority when several servers are installed", () => {
  const dir = stubServerDir("clangd");
  writeFileSync(join(dir, process.platform === "win32" ? "gopls.CMD" : "gopls"), "");
  withPath(dir, () => {
    // Both languages are present and both servers are installed; LSP_SERVERS order
    // is the tiebreak, and clangd sits above gopls in it.
    assert.match(pickServer(new Set(["c", "go"]))!.command, /clangd/);
    // …but a language clangd doesn't cover still falls through to gopls.
    assert.match(pickServer(new Set(["go"]))!.command, /gopls/);
  });
});

test("pickServer returns null when the language is present but its server is not installed", () => {
  withPath(tmpRepo("lsp-empty"), () => {
    assert.equal(pickServer(new Set(["rust", "go", "python"])), null);
  });
});

test("a quoted PATH entry still resolves (Windows writes them that way)", () => {
  const dir = stubServerDir("gopls");
  withPath(`"${dir}"${delimiter}`, () => {
    assert.ok(pickServer(new Set(["go"])), "the surrounding quotes are not part of the directory name");
  });
});

test("enrichWithLsp is a no-op when no server matches the repo's languages", async () => {
  // A graph whose only file is an unsupported language → no server is picked →
  // no process spawned, graph returned unchanged.
  const graph: GraphV1 = {
    meta: { version: 1, nodeCount: 1, edgeCount: 0, languages: ["text"], scopes: [] },
    nodes: [
      { id: "notes.txt", name: "notes.txt", kind: "file", path: "notes.txt", span: "L1-L1",
        signature: null, exported: true, origin: "ast", body_hash: "x", summary_state: "pending", summary: null, crux: null },
    ],
    edges: [],
  };
  const before = graph.edges.length;
  const r = await enrichWithLsp(graph, "/tmp/does-not-matter");
  assert.equal(r.server, null, "no server selected for an unsupported language");
  assert.equal(r.added, 0);
  assert.equal(graph.edges.length, before, "graph edges untouched");
});
