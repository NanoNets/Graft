/**
 * A5 — `graft build --include-dir <name>` end-to-end through the real CLI.
 *
 * SKIP_DIRS eats real source in some ecosystems (e.g. a build/ directory that
 * genuinely holds hand-written code). This is the explicit, persisted
 * override: no git-awareness (graft's documented no-git invariant), just a
 * per-repo state file that later no-flag builds — and the fingerprint probe,
 * which never sees CLI flags at all — read identically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { probeDrift, isClean } from "../src/graph/fingerprint.js";
import type { GraphV1 } from "../src/graph/types.js";

function repoWithBuildDir(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-include-dir-"));
  mkdirSync(join(d, "build"), { recursive: true });
  writeFileSync(join(d, "build", "util.ts"), "export function fromBuild(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "main.ts"), "export function main(): number {\n  return 2;\n}\n");
  return d;
}

function runCli(args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { stdio: "pipe" });
}

/** Like {@link runCli}, but captures a non-zero exit instead of throwing —
 * for the --include-dir validation tests, which expect `graft build` to
 * reject bad input rather than run to completion. */
function runCliCapture(args: string[]): { stdout: string; stderr: string; status: number } {
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

function graphOf(d: string): GraphV1 | null {
  return readGraph(wiringPath(join(d, "graft")));
}

test("A5: build/ is absent by default, present with --include-dir build, persists across a no-flag rebuild, and the fingerprint probe agrees (no drift loop)", () => {
  const d = repoWithBuildDir();

  runCli(["build", d]);
  const cold = graphOf(d);
  assert.ok(cold, "expected a built graph.json");
  assert.ok(!cold!.nodes.some((n) => n.path.startsWith("build/")), "build/ must be absent by default (SKIP_DIRS)");
  assert.ok(cold!.nodes.some((n) => n.id === "main.ts#main"), "sanity: the non-skipped file is indexed");

  runCli(["build", d, "--include-dir", "build"]);
  const withFlag = graphOf(d);
  assert.ok(withFlag);
  assert.ok(
    withFlag!.nodes.some((n) => n.id === "build/util.ts#fromBuild"),
    "build/ must be included this run, with the flag",
  );

  // No flag this time — the persisted state must still include it.
  runCli(["build", d]);
  const persisted = graphOf(d);
  assert.ok(persisted);
  assert.ok(
    persisted!.nodes.some((n) => n.id === "build/util.ts#fromBuild"),
    "a follow-up NO-FLAG rebuild must still include build/ (state-persisted)",
  );

  // The fingerprint probe (the fast path `ensureFreshGraph`/hooks use, which
  // never sees CLI flags) must read the same persisted include set — so it
  // recognizes build/util.ts as already-tracked, not perpetually "added".
  const drift = probeDrift(d, join(d, "graft"));
  assert.ok(drift, "expected a fingerprint to probe against");
  assert.ok(isClean(drift!), `probe must report clean, got ${JSON.stringify(drift)}`);
});

// --include-dir takes bare SKIP_DIRS-style directory NAMES, never paths, and
// dot-dirs are (per the option's own help text) never overridable at all.
// Without validation, a value like ".github" or "foo/bar" would silently
// persist and then just never match any real directory name walkDir compares
// against (shouldSkipDir compares against a single path segment), so the flag
// would look accepted while doing nothing.

test("A5: --include-dir rejects a dot-prefixed name", () => {
  const d = repoWithBuildDir();
  try {
    const r = runCliCapture(["build", d, "--include-dir", ".github"]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /--include-dir/);
    assert.match(r.stderr, /\.github/);
    assert.equal(existsSync(join(d, "graft", ".cache", "config.json")), false, "must not persist an invalid value");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("A5: --include-dir rejects a value containing a path separator", () => {
  const d = repoWithBuildDir();
  try {
    const r = runCliCapture(["build", d, "--include-dir", "foo/bar"]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /--include-dir/);
    assert.match(r.stderr, /foo\/bar/);
    assert.equal(existsSync(join(d, "graft", ".cache", "config.json")), false, "must not persist an invalid value");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("A5: --include-dir rejects a value containing a backslash", () => {
  const d = repoWithBuildDir();
  try {
    const r = runCliCapture(["build", d, "--include-dir", "foo\\bar"]);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /--include-dir/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("A5: a later valid --include-dir still works (validation isn't over-eager)", () => {
  const d = repoWithBuildDir();
  try {
    runCli(["build", d, "--include-dir", "build"]);
    const g = graphOf(d);
    assert.ok(g && g.nodes.some((n) => n.id === "build/util.ts#fromBuild"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
