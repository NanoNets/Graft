/**
 * `graft build --only-dir <path>` end-to-end through the real CLI.
 *
 * The whitelist is the inverse of SKIP_DIRS: when set, ONLY files under the
 * listed repo-relative prefixes are indexed, and everything else (including
 * top-level files) is skipped. Like `--include-dir`, it persists to the local
 * `.graft/config.json` so a later no-flag build — and the fingerprint probe,
 * which never sees CLI flags — walk the same set. That last property is what
 * keeps a limited build from looping: excluded files must not read as phantom
 * "added" drift on every query.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { probeDrift, isClean } from "../src/graph/fingerprint.js";
import type { GraphV1 } from "../src/graph/types.js";

function repoWithDirs(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-only-dir-"));
  mkdirSync(join(d, "src", "a"), { recursive: true });
  mkdirSync(join(d, "src", "b"), { recursive: true });
  writeFileSync(join(d, "src", "a", "a.ts"), "export function a(): number {\n  return 1;\n}\n");
  writeFileSync(join(d, "src", "b", "b.ts"), "export function b(): number {\n  return 2;\n}\n");
  writeFileSync(join(d, "top.ts"), "export function top(): number {\n  return 3;\n}\n");
  return d;
}

function runCli(args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { stdio: "pipe" });
}

function graphOf(d: string): GraphV1 | null {
  return readGraph(wiringPath(join(d, "graft")));
}

test("--only-dir limits the walk to listed prefixes, persists, and the fingerprint probe stays clean", () => {
  const d = repoWithDirs();
  try {
    // Default: everything is indexed.
    runCli(["build", d]);
    const full = graphOf(d);
    assert.ok(full, "expected a built graph");
    assert.ok(full!.nodes.some((n) => n.path === "src/a/a.ts"), "src/a indexed by default");
    assert.ok(full!.nodes.some((n) => n.path === "src/b/b.ts"), "src/b indexed by default");
    assert.ok(full!.nodes.some((n) => n.path === "top.ts"), "top.ts indexed by default");

    // Only src/a.
    runCli(["build", d, "--only-dir", "src/a"]);
    const limited = graphOf(d);
    assert.ok(limited, "expected a rebuilt graph");
    assert.ok(limited!.nodes.some((n) => n.path === "src/a/a.ts"), "src/a must be indexed");
    assert.ok(!limited!.nodes.some((n) => n.path === "src/b/b.ts"), "src/b must be skipped");
    assert.ok(!limited!.nodes.some((n) => n.path === "top.ts"), "top.ts must be skipped");

    // No flag this time: the persisted whitelist must still apply.
    runCli(["build", d]);
    const persisted = graphOf(d);
    assert.ok(persisted, "expected a rebuilt graph");
    assert.ok(persisted!.nodes.some((n) => n.path === "src/a/a.ts"), "persisted: src/a indexed");
    assert.ok(!persisted!.nodes.some((n) => n.path === "src/b/b.ts"), "persisted: src/b skipped");
    assert.ok(!persisted!.nodes.some((n) => n.path === "top.ts"), "persisted: top.ts skipped");

    // The fingerprint probe (the fast path `ensureFreshGraph`/hooks use, which
    // never sees CLI flags) must enumerate the same whitelisted set — so the
    // excluded src/b and top.ts are NOT reported as phantom "added" drift.
    const drift = probeDrift(d, join(d, "graft"));
    assert.ok(drift && isClean(drift), "excluded files must not read as drift");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--only-dir rejects a prefix that normalizes to empty", () => {
  const d = repoWithDirs();
  try {
    let failed = false;
    try {
      execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", "build", d, "--only-dir", "/"], {
        stdio: "pipe",
      });
    } catch {
      failed = true;
    }
    assert.ok(failed, "a bare / prefix must be rejected");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
