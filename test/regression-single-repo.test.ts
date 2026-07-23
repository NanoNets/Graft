/**
 * Task-7 permanent regression gate: the scope-aware-ranking work must be
 * INVISIBLE on ordinary single-repo graphs. A repo with only root-level
 * markers is a single scope, so every retrieval surface (ask / map / grep /
 * callers) must (a) still return real results and (b) emit NO scope machinery
 * — no `[scope/]` hit labels, no `matched in:` / `also matched:` footer, and
 * no multi-scope `meta.scopes` / `.scopes` payload. This is the "no regression"
 * half of the acceptance gate, frozen as a unit test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGraph } from "../src/graph/build.js";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { loadGraphCached } from "../src/graph/load.js";
import { contextDirFor } from "../src/context/node-file.js";
import { scopesOfGraph } from "../src/graph/scopes.js";
import { ask, formatAsk, type AskResult } from "../src/ask/ask.js";
import { buildRepoMap, formatRepoMap } from "../src/graph/map.js";
import { grepGraph } from "../src/search/grep.js";
import { resolveSymbol, callersOf } from "../src/graph/traverse.js";
import type { GraphV1 } from "../src/graph/types.js";

/** Materialize a fixture repo from a path→content map. */
function fx(layout: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "regress-single-"));
  for (const [p, content] of Object.entries(layout)) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), content);
  }
  return dir;
}

/** Three single-repo fixtures, each with ONLY root-level project markers so
 * scope discovery collapses to the canonical single (root) scope. */
const FIXTURES: Record<string, Record<string, string>> = {
  // TypeScript only.
  "ts-only": {
    "package.json": JSON.stringify({ name: "ts-only" }),
    "src/server.ts":
      "export function handleRequest(req: unknown) { return validateInput(req); }\n" +
      "export function validateInput(x: unknown) { return x != null; }\n" +
      "export function startServer() { return handleRequest({}); }\n",
    "src/util.ts": "export function formatError(e: Error) { return e.message; }\n",
  },
  // Python only.
  "py-only": {
    "pyproject.toml": '[project]\nname = "py-only"\n',
    "app.py":
      "def handle_request(req):\n    return validate_input(req)\n\n" +
      "def validate_input(x):\n    return x is not None\n\n" +
      "def start_server():\n    return handle_request({})\n",
    "errors.py": "def format_error(e):\n    return str(e)\n",
  },
  // Mixed languages, but still ONLY root-level markers -> one scope.
  mixed: {
    "package.json": JSON.stringify({ name: "mixed" }),
    "pyproject.toml": '[project]\nname = "mixed"\n',
    "gateway.ts":
      "export function routeRequest(p: string) { return dispatch(p); }\n" +
      "export function dispatch(p: string) { return p.length; }\n",
    "worker.py":
      "def process_job(job):\n    return compute_result(job)\n\n" +
      "def compute_result(job):\n    return len(job)\n",
  },
};

/** Text output must carry no scope machinery. */
function assertScopeFreeText(label: string, text: string) {
  assert.ok(text.length > 0, `${label}: expected non-empty output`);
  assert.doesNotMatch(text, /\[[^\]\n]+\/\]\s/, `${label}: unexpected [scope/] label in text`);
  assert.doesNotMatch(text, /^matched in:/m, `${label}: unexpected "matched in:" footer`);
  assert.doesNotMatch(text, /^also matched:/m, `${label}: unexpected "also matched:" footer`);
  assert.doesNotMatch(text, /scopes here:/, `${label}: unexpected "scopes here:" clause`);
}

for (const [name, layout] of Object.entries(FIXTURES)) {
  test(`single-repo (${name}): retrieval works and stays scope-free`, async () => {
    const dir = fx(layout);
    try {
      await buildGraph(dir);
      const outDir = contextDirFor(dir);
      const written = readGraph(wiringPath(outDir)) as GraphV1;
      const graph = loadGraphCached(outDir) as GraphV1;
      assert.ok(graph, `${name}: graph should load`);

      // (a) NO multi-scope meta: a root-only-marker repo is a single scope.
      const scopes = scopesOfGraph(written);
      assert.equal(scopes.length, 1, `${name}: expected exactly one scope`);
      assert.equal(scopes[0].prefix, "", `${name}: the single scope must be the root scope`);

      // ---- ask ----
      const askQueries = name === "py-only"
        ? ["how is input validated", "handle request"]
        : name === "mixed"
          ? ["how are requests routed", "process the job"]
          : ["how is input validated", "handle request"];
      let anyAskHits = false;
      for (const q of askQueries) {
        const r: AskResult = ask(dir, q, { limit: 8 });
        if (r.hits.length > 0) anyAskHits = true;
        assert.equal(r.scopes, undefined, `${name}/ask "${q}": no scopes meta on single-repo`);
        assertScopeFreeText(`${name}/ask "${q}"`, formatAsk(r));
      }
      assert.ok(anyAskHits, `${name}: ask returned hits for at least one query`);

      // ---- map ----
      const map = buildRepoMap(graph);
      assert.equal(map.scopes, undefined, `${name}/map: no per-scope grouping on single-repo`);
      assert.ok(map.dirs.length > 0, `${name}/map: expected directory entries`);
      assertScopeFreeText(`${name}/map`, formatRepoMap(map));

      // ---- grep ----
      const grep = grepGraph(graph, dir, "return");
      assert.ok(grep.groups.length > 0, `${name}/grep: expected matching groups`);
      assert.ok(grep.totalHits > 0, `${name}/grep: expected hits`);

      // ---- callers ----
      const calleeName = name === "py-only"
        ? "validate_input"
        : name === "mixed"
          ? "dispatch"
          : "validateInput";
      const targets = resolveSymbol(graph, calleeName);
      assert.ok(targets.length > 0, `${name}/callers: symbol "${calleeName}" should resolve`);
      const callers = callersOf(graph, targets[0]);
      assert.ok(callers.length > 0, `${name}/callers: "${calleeName}" should have >=1 caller`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
