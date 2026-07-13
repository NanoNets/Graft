/**
 * The benchmark agent's filesystem tools run model-chosen paths. safePath is
 * the confinement boundary — assert it rejects escapes and accepts in-root paths.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { safePath } from "../bench/agent.js";

const root = mkdtempSync(join(tmpdir(), "cge-safepath-"));
mkdirSync(join(root, "sub"), { recursive: true });
writeFileSync(join(root, "a.txt"), "hi");
writeFileSync(join(root, "sub", "b.txt"), "yo");

test("accepts paths inside the root", () => {
  assert.ok(safePath(root, "a.txt").endsWith("a.txt"));
  assert.ok(safePath(root, "sub/b.txt").endsWith("b.txt"));
  assert.ok(safePath(root, "./sub/../a.txt").endsWith("a.txt"));
});

test("rejects parent-directory escapes", () => {
  assert.throws(() => safePath(root, "../../etc/passwd"), /escapes root/);
  assert.throws(() => safePath(root, "sub/../../secret"), /escapes root/);
});

test("rejects absolute paths outside the root", () => {
  assert.throws(() => safePath(root, "/etc/passwd"), /escapes root/);
});
