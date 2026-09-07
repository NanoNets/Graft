/**
 * A committed `.graftignore` — one repo-relative path per line — leaves those
 * paths out of every enumeration with no flag: the build, `check`, the freshness
 * probe (so the hooks/refresh path keeps the same set) and, through the same
 * helper, `--deep`. It exists for a path Git tracks that graft must never index:
 * a generated copy of real source doubles every symbol and drops every
 * owner-qualified call as ambiguous, and `--exclude-dir` alone is forgotten the
 * moment someone builds a fresh checkout without it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readGraph, wiringPath } from "../src/graph/write.js";
import { probeDrift, isClean, readFingerprint } from "../src/graph/fingerprint.js";
import { readGraftIgnore } from "../src/graph/source-files.js";
import type { GraphV1 } from "../src/graph/types.js";

function repoWithCopies(): string {
  const d = mkdtempSync(join(tmpdir(), "graft-graftignore-"));
  mkdirSync(join(d, "src"), { recursive: true });
  mkdirSync(join(d, "cloud", "src"), { recursive: true });
  mkdirSync(join(d, "cloud", "lib"), { recursive: true });
  mkdirSync(join(d, "design"), { recursive: true });
  const app = "const MN = {};\nMN.run = (n) => {\n  return n;\n};\n";
  writeFileSync(join(d, "src", "app.js"), app);
  writeFileSync(join(d, "cloud", "src", "app.js"), app);
  writeFileSync(join(d, "design", "app.js"), app);
  writeFileSync(join(d, "cloud", "lib", "runner.js"), "function go() {\n  return MN.run(1);\n}\n");
  return d;
}

function runCli(args: string[]): void {
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { stdio: "pipe" });
}

function files(d: string): string[] {
  const g = readGraph(wiringPath(join(d, "graft"))) as GraphV1;
  return g.nodes.filter((n) => n.kind === "file").map((n) => n.path).sort();
}

test("readGraftIgnore: comments, blanks, ./ and trailing slashes, duplicates, a bare /", () => {
  const d = mkdtempSync(join(tmpdir(), "graft-graftignore-parse-"));
  try {
    writeFileSync(join(d, ".graftignore"), "# copies of src\n\n./cloud/src/\ndesign\ncloud/src\n/\n  # indented comment\n");
    assert.deepEqual(readGraftIgnore(d), ["cloud/src", "design"]);
    assert.deepEqual(readGraftIgnore(join(d, "nowhere")), []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test(".graftignore leaves the listed paths out of build, check and the probe, with no flag", () => {
  const d = repoWithCopies();
  try {
    writeFileSync(join(d, ".graftignore"), "# generated copies of src/ that Git tracks\ncloud/src\ndesign/\n");
    runCli(["build", d]);
    assert.deepEqual(files(d), ["cloud/lib/runner.js", "src/app.js"]);
    const g = readGraph(wiringPath(join(d, "graft"))) as GraphV1;
    const call = g.edges.find((e) => e.relation === "calls" && e.source === "cloud/lib/runner.js#go");
    assert.equal(call?.target, "src/app.js#MN.run", "with the copies gone the call resolves to the one definition");

    // Only flags are recorded; the file is read live.
    assert.equal(readFingerprint(join(d, "graft"))?.excludeDirs, undefined);
    const drift = probeDrift(d, join(d, "graft"));
    assert.ok(drift && isClean(drift), "ignored files must not read as drift");
    runCli(["check", d]);

    // Composes with the flag, de-duplicated.
    runCli(["build", d, "--exclude-dir", "cloud/src", "--exclude-dir", "cloud/lib"]);
    assert.deepEqual(files(d), ["src/app.js"]);
    assert.deepEqual(readFingerprint(join(d, "graft"))?.excludeDirs, ["cloud/src", "cloud/lib"]);

    // Removing the file brings the paths back on the next plain build.
    unlinkSync(join(d, ".graftignore"));
    runCli(["build", d]);
    assert.deepEqual(files(d), ["cloud/lib/runner.js", "cloud/src/app.js", "design/app.js", "src/app.js"]);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
