/**
 * `graft build --exclude-dir <path>` end-to-end through the real CLI.
 *
 * The complement of `--only-dir`: files at or under the listed repo-relative
 * prefixes are left out. It exists for a committed, generated copy of real
 * source — Git's ignore rules cannot hide a tracked file, so without it every
 * symbol in such a repo appears twice and every owner-qualified call drops as
 * ambiguous. Like the whitelist it is recorded in the fingerprint, never in the
 * source repo's `.graft/config.json`, so the query-path freshness probe and
 * `graft check` enumerate the identical set.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { probeDrift, isClean, readFingerprint } from "../src/graph/fingerprint.js";
import type { GraphV1 } from "../src/graph/types.js";

function repoWithCopy(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-exclude-dir-"));
  mkdirSync(join(d, "src"), { recursive: true });
  mkdirSync(join(d, "cloud", "src"), { recursive: true });
  mkdirSync(join(d, "cloud", "lib"), { recursive: true });
  const app = "const MN = {};\nMN.run = (n) => {\n  return n;\n};\n";
  writeFileSync(join(d, "src", "app.js"), app);
  writeFileSync(join(d, "cloud", "src", "app.js"), app); // the committed generated copy
  writeFileSync(join(d, "cloud", "lib", "runner.js"), "function go() {\n  return MN.run(1);\n}\n");
  return d;
}

function runCli(args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { stdio: "pipe" });
}

function graphOf(d: string): GraphV1 | null {
  return readGraph(wiringPath(join(d, "graft")));
}

test("--exclude-dir drops the prefix, records it in the fingerprint, and check/probe stay clean", () => {
  const d = repoWithCopy();
  try {
    // Default: the copy is indexed too, and the owner-qualified call is ambiguous.
    runCli(["build", d]);
    const full = graphOf(d)!;
    assert.ok(full.nodes.some((n) => n.path === "cloud/src/app.js"), "copy indexed by default");
    assert.equal(full.edges.filter((e) => e.relation === "calls" && e.source === "cloud/lib/runner.js#go").length, 0);

    runCli(["build", d, "--exclude-dir", "cloud/src"]);
    const limited = graphOf(d)!;
    assert.ok(limited.nodes.some((n) => n.path === "src/app.js"), "src must stay indexed");
    assert.ok(limited.nodes.some((n) => n.path === "cloud/lib/runner.js"), "siblings of the copy must stay indexed");
    assert.ok(!limited.nodes.some((n) => n.path === "cloud/src/app.js"), "the copy must be skipped");
    const call = limited.edges.find((e) => e.relation === "calls" && e.source === "cloud/lib/runner.js#go");
    assert.equal(call?.target, "src/app.js#MN.run", "with the copy gone the call resolves");

    const fp = readFingerprint(join(d, "graft"));
    assert.deepEqual(fp?.excludeDirs, ["cloud/src"], "fingerprint must record the exclusion");
    assert.ok(!existsSync(join(d, ".graft", "config.json")), "source repo config must be untouched");

    const drift = probeDrift(d, join(d, "graft"));
    assert.ok(drift && isClean(drift), "excluded files must not read as drift");
    runCli(["check", d]); // exit 1 on drift — the excluded copy must not count
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--exclude-dir composes with --only-dir", () => {
  const d = repoWithCopy();
  try {
    runCli(["build", d, "--only-dir", "cloud", "--exclude-dir", "cloud/src"]);
    const g = graphOf(d)!;
    const paths = new Set(g.nodes.filter((n) => n.kind === "file").map((n) => n.path));
    assert.deepEqual([...paths].sort(), ["cloud/lib/runner.js"]);
    const fp = readFingerprint(join(d, "graft"));
    assert.deepEqual(fp?.onlyDirs, ["cloud"]);
    assert.deepEqual(fp?.excludeDirs, ["cloud/src"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("--exclude-dir rejects a prefix that normalizes to empty", () => {
  const d = repoWithCopy();
  try {
    let failed = false;
    try {
      runCli(["build", d, "--exclude-dir", "/"]);
    } catch {
      failed = true;
    }
    assert.ok(failed, "a bare / prefix must be rejected");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
