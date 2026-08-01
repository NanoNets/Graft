import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ALL_IGNORE_GROUPS,
  KOTLIN_GRADLE_IGNORE_GROUP,
  DART_FLUTTER_IGNORE_GROUP,
  createDefaultIgnore,
} from "../src/ingest/ignore-rules.js";
import { loadGraftIgnore, walkDir, SKIP_DIRS } from "../src/ingest/fs.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "ignore-rules-test-"));
}

test("ALL_IGNORE_GROUPS: contains all modular ecosystem groups", () => {
  const ids = ALL_IGNORE_GROUPS.map((g) => g.id);
  assert.ok(ids.includes("general"));
  assert.ok(ids.includes("npm"));
  assert.ok(ids.includes("python"));
  assert.ok(ids.includes("kotlin-gradle"));
  assert.ok(ids.includes("dart-flutter"));
  assert.ok(ids.includes("go"));
});

test("SKIP_DIRS: includes directories from all ecosystem groups", () => {
  assert.ok(SKIP_DIRS.has("node_modules"));
  assert.ok(SKIP_DIRS.has("__pycache__"));
  assert.ok(SKIP_DIRS.has(".gradle"));
  assert.ok(SKIP_DIRS.has(".dart_tool"));
  assert.ok(SKIP_DIRS.has("vendor"));
});

test("createDefaultIgnore: evaluates pattern rules for Kotlin/Gradle and Dart/Flutter", () => {
  const ig = createDefaultIgnore();
  assert.ok(ig.ignores("build/"));
  assert.ok(ig.ignores("build/outputs/app.apk"));
  assert.ok(ig.ignores("App.class"));
  assert.ok(ig.ignores("library.aar"));

  assert.ok(ig.ignores(".dart_tool/package_config.json"));
  assert.ok(ig.ignores(".pub-cache/hosted/pub.dev/foo"));

  assert.ok(ig.ignores("__pycache__/foo.pyc"));
  assert.ok(ig.ignores("bundle.min.js"));
});

test("walkDir: excludes Kotlin/Gradle build outputs and bytecode files", () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, "src", "main", "kotlin"), { recursive: true });
    mkdirSync(join(dir, "build", "classes"), { recursive: true });

    writeFileSync(join(dir, "src", "main", "kotlin", "Main.kt"), "fun main() {}");
    writeFileSync(join(dir, "build", "classes", "Main.class"), "bytecode");
    writeFileSync(join(dir, "src", "main", "kotlin", "Main.class"), "compiled bytecode");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    assert.ok(files.includes("src/main/kotlin/Main.kt"));
    assert.ok(!files.includes("build/classes/Main.class"));
    assert.ok(!files.includes("src/main/kotlin/Main.class"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("walkDir: excludes Dart/Flutter build output and tool caches", () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, "lib"));
    mkdirSync(join(dir, ".dart_tool"));
    mkdirSync(join(dir, ".pub-cache"));

    writeFileSync(join(dir, "lib", "main.dart"), "void main() {}");
    writeFileSync(join(dir, ".dart_tool", "package_config.json"), "{}");
    writeFileSync(join(dir, ".pub-cache", "cached.dart"), "// cached");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    assert.ok(files.includes("lib/main.dart"));
    assert.ok(!files.includes(".dart_tool/package_config.json"));
    assert.ok(!files.includes(".pub-cache/cached.dart"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadGraftIgnore: supports user .graftignore negated rules", () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, "vendor"));
    writeFileSync(join(dir, ".graftignore"), "!vendor/\nvendor/*\n!vendor/custom.go\n");
    writeFileSync(join(dir, "vendor", "ignored.go"), "package vendor");
    writeFileSync(join(dir, "vendor", "custom.go"), "package custom");

    const files = walkDir(dir).map((f) => f.slice(dir.length + 1).replace(/\\/g, "/"));

    assert.ok(files.includes("vendor/custom.go"));
    assert.ok(!files.includes("vendor/ignored.go"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
