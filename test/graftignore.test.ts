import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGraftIgnore, walkDir } from "../src/ingest/fs.js";
import { buildGraph } from "../src/graph/build.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "graftignore-test-"));
}

test("loadGraftIgnore: returns an Ignore instance with default ecosystem rules when no .graftignore exists", () => {
  const dir = makeTmpDir();
  try {
    const ig = loadGraftIgnore(dir);
    assert.ok(ig);
    assert.ok(ig.ignores("node_modules/"));
    assert.ok(ig.ignores(".gradle/"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadGraftIgnore & walkDir: respects root .graftignore rules", () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, ".graftignore"), "ignored_dir/\n*.secret\n");
    writeFileSync(join(dir, "keep.ts"), "export const keep = 1;");
    writeFileSync(join(dir, "hide.secret"), "export const hide = 1;");
    
    mkdirSync(join(dir, "ignored_dir"));
    writeFileSync(join(dir, "ignored_dir", "foo.ts"), "export const foo = 1;");

    mkdirSync(join(dir, "included_dir"));
    writeFileSync(join(dir, "included_dir", "bar.ts"), "export const bar = 1;");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    assert.ok(files.includes("keep.ts"));
    assert.ok(files.includes("included_dir/bar.ts"));
    assert.ok(!files.includes("hide.secret"));
    assert.ok(!files.includes("ignored_dir/foo.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDir: ignores subfolder .graftignore files as rule sources", () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, "sub"));
    // Subfolder has a .graftignore that attempts to ignore sub_hidden.ts
    writeFileSync(join(dir, "sub", ".graftignore"), "sub_hidden.ts\n");
    writeFileSync(join(dir, "sub", "sub_hidden.ts"), "export const subHidden = 1;");
    writeFileSync(join(dir, "sub", "normal.ts"), "export const normal = 1;");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    // sub_hidden.ts should NOT be ignored because subfolder .graftignore is ignored as a rule source
    assert.ok(files.includes("sub/sub_hidden.ts"));
    assert.ok(files.includes("sub/normal.ts"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDir: handles negation rules in root .graftignore", () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, ".graftignore"), "*.log\n!important.log\n");
    writeFileSync(join(dir, "debug.log"), "debug log");
    writeFileSync(join(dir, "important.log"), "important log");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    assert.ok(!files.includes("debug.log"));
    assert.ok(files.includes("important.log"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildGraph: ignores files matching .graftignore", async () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, ".graftignore"), "temp/\n");
    writeFileSync(join(dir, "index.ts"), "export function main() {}");
    
    mkdirSync(join(dir, "temp"));
    writeFileSync(join(dir, "temp", "secret.ts"), "export function secret() {}");

    const result = await buildGraph(dir);
    assert.ok(result.files === 1, `Expected 1 file parsed, got ${result.files}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
