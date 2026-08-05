import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { walkDir } from "../src/ingest/fs.js";

function fixture(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `graft-walk-${tag}-`));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function write(root: string, path: string, content = "export const value = 1;\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function walked(root: string): string[] {
  return walkDir(root)
    .map((path) => relative(root, path).replace(/\\/g, "/"))
    .sort();
}

test("walkDir respects root and nested .gitignore rules, including negation", () => {
  const dir = fixture("ignore");
  try {
    write(dir, ".gitignore", "Scripts/bundles/\ngenerated/*\n!generated/keep.ts\n");
    write(dir, "src/app.ts");
    write(dir, "Scripts/bundles/app.js");
    write(dir, "generated/drop.ts");
    write(dir, "generated/keep.ts");
    write(dir, "packages/tool/.gitignore", "output/\n");
    write(dir, "packages/tool/index.ts");
    write(dir, "packages/tool/output/bundle.js");

    assert.deepEqual(walked(dir), [
      "generated/keep.ts",
      "packages/tool/index.ts",
      "src/app.ts",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDir keeps tracked files that match an ignore rule and untracked visible files", () => {
  const dir = fixture("tracked");
  try {
    write(dir, ".gitignore", "*.generated.ts\n");
    write(dir, "tracked.generated.ts");
    write(dir, "ignored.generated.ts");
    write(dir, "visible.ts");
    execFileSync("git", ["add", "-f", "tracked.generated.ts"], { cwd: dir });

    assert.deepEqual(walked(dir), ["tracked.generated.ts", "visible.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDir retains fixed skips and filesystem fallback outside Git", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-walk-nongit-"));
  try {
    write(dir, "src/app.ts");
    write(dir, "node_modules/pkg/index.ts");
    write(dir, ".hidden/secret.ts");

    assert.deepEqual(walked(dir), ["src/app.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
