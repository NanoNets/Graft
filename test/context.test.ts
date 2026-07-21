/**
 * End-to-end tests for the markdown-graph pipeline (`init` → `check`), driven by
 * offline test doubles so no LLM/network is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildContext } from "../src/context/build.js";
import { checkContext } from "../src/context/check.js";
import { fakeProviders } from "./helpers.js";

// CLI-spawn helper (same pattern as test/graph-traverse-cli.test.ts) — these tests
// exercise the real process boundary (exit codes), which a unit-level call into
// checkContext()/checkGraph() can't: the pass/fail decision lives in cli.ts's
// `check` action, combining both layers' results.
function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, stderr: "", status: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", status: e.status ?? 1 };
  }
}

function makeFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-"));
  writeFileSync(
    join(dir, "auth.ts"),
    `// [[Auth Service]] ==depends_on==> [[Token Store]]\nexport const auth = 1;\n`,
  );
  writeFileSync(
    join(dir, "billing.ts"),
    `// [[Billing]] ==uses==> [[Auth Service]]\nexport const billing = 2;\n`,
  );
  return dir;
}

function buildOpts() {
  return { model: "fake", ...fakeProviders() };
}

test("init builds one markdown node per entity, with links and a manifest", async () => {
  const dir = makeFixture();
  try {
    const r = await buildContext(dir, buildOpts());
    // Auth Service, Token Store, Billing.
    assert.equal(r.nodes, 3);
    assert.equal(r.links, 2);
    assert.equal(r.files, 2);

    const ctx = join(dir, "graft");
    assert.ok(existsSync(join(ctx, "auth-service.md")));
    assert.ok(existsSync(join(ctx, "token-store.md")));
    assert.ok(existsSync(join(ctx, "billing.md")));
    assert.ok(existsSync(join(ctx, "manifest.json")));

    // Auth Service is referenced from BOTH files → multi-source provenance.
    const authMd = readFileSync(join(ctx, "auth-service.md"), "utf8");
    assert.match(authMd, /path: auth\.ts/);
    assert.match(authMd, /path: billing\.ts/);
    // Its edge to Token Store is rendered as a wiki-link.
    assert.match(authMd, /\[\[token-store\]\]/);

    const manifest = JSON.parse(readFileSync(join(ctx, "manifest.json"), "utf8"));
    assert.equal(manifest.files.length, 2);
    assert.equal(manifest.nodes.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check passes immediately after init", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    const r = checkContext(dir);
    assert.equal(r.ok, true);
    assert.equal(r.missing, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check reports NO GRAPH when init never ran", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-"));
  try {
    const r = checkContext(dir);
    assert.equal(r.missing, true);
    assert.equal(r.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check detects content drift when a source file changes", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "auth.ts"), `// [[Auth Service]]\nexport const auth = 999;\n`);
    const r = checkContext(dir);
    assert.equal(r.ok, false);
    assert.equal(r.contentDrift.length, 1);
    assert.equal(r.contentDrift[0].path, "auth.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check detects a new file not yet in the graph (coverage drift)", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "new.ts"), `// [[New Thing]]\nexport const n = 3;\n`);
    const r = checkContext(dir);
    assert.equal(r.ok, false);
    assert.deepEqual(r.coverage, ["new.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("re-running init clears drift", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    writeFileSync(join(dir, "new.ts"), `// [[New Thing]]\nexport const n = 3;\n`);
    assert.equal(checkContext(dir).ok, false);
    await buildContext(dir, buildOpts());
    assert.equal(checkContext(dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("human notes below the generated block survive regeneration", async () => {
  const dir = makeFixture();
  try {
    await buildContext(dir, buildOpts());
    const path = join(dir, "graft", "billing.md");
    const withNote = readFileSync(path, "utf8") + "\nHand-written note: watch out for retries.\n";
    writeFileSync(path, withNote);
    await buildContext(dir, buildOpts());
    assert.match(readFileSync(path, "utf8"), /Hand-written note: watch out for retries\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// `graft check` on the CLI combines the markdown-context layer (checkContext) and the
// wiring-graph layer (checkGraph). A keyless `graft build` (no --deep) only ever produces
// the wiring layer — manifest.json (markdown layer) is never written — so `check` must not
// treat that absence as failure on its own.
test("graft check: keyless build (no --deep) exits 0 — wiring graph present, markdown layer never built", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    writeFileSync(join(dir, "math.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const built = runCli(["build", dir]);
    assert.equal(built.status, 0);

    const r = runCli(["check", dir]);
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /deep layer: not built/);
    assert.match(r.stdout, /wiring graph is the source of truth/);
    assert.match(r.stdout, /graph check: OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("graft check: neither layer ever built exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    const r = runCli(["check", dir]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /NO GRAPH/);
    assert.match(r.stdout, /graft build/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("graft check: keyless build then code changes (wiring stale) exits 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "ctxgraph-cli-"));
  try {
    const file = join(dir, "math.ts");
    writeFileSync(file, "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const built = runCli(["build", dir]);
    assert.equal(built.status, 0);

    // Change the code without rebuilding — the wiring graph (the only layer that
    // exists) is now stale, so check must fail even though the markdown layer is
    // still just "not built" rather than "stale".
    writeFileSync(
      file,
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n" +
        "export function sub(a: number, b: number): number {\n  return a - b;\n}\n",
    );

    const r = runCli(["check", dir]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout, /graph check: STALE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
