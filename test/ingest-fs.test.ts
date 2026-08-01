import { execFileSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { shouldSkipDir, walkDir, SKIP_DIRS } from "../src/ingest/fs.js";
import { discoverScopes, discoverWorkspaceChildren } from "../src/graph/scopes.js";

function fixture(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `graft-walk-${tag}-`));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function write(root: string, path: string, content = "export const value = 1;\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

function walked(root: string, includes?: ReadonlySet<string>): string[] {
  return walkDir(root, includes)
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

/**
 * A5 — `shouldSkipDir` and its `--include-dir` override.
 *
 * "Is this name dot-prefixed or in SKIP_DIRS" is re-implemented by hand in
 * three places: `skippedPath`'s per-segment predicate and `walkFilesystem`'s
 * directory check (both src/ingest/fs.ts), and `discoverWorkspaceChildren`'s
 * git-child filter (src/graph/scopes.ts). This introduces `shouldSkipDir` as
 * the single source of truth, with an optional `includes` param: a name in it
 * is removed from the effective skip set for this repo's walks (persisted via
 * `graft build --include-dir`), while a dot-directory stays non-overridable
 * regardless.
 *
 * `--include-dir` lifts only graft's OWN skip list. In a Git repo, Git's
 * ignore rules stay authoritative: an ignored directory remains excluded even
 * when named — un-ignore it (or `git add -f`) to index it, the same contract
 * the walker already applies to tracked-but-ignored files.
 */

test("shouldSkipDir: every SKIP_DIRS name and any dot-prefixed name is skipped; an ordinary name is not", () => {
  for (const name of SKIP_DIRS) assert.equal(shouldSkipDir(name), true, `${name} should be skipped`);
  assert.equal(shouldSkipDir(".git"), true);
  assert.equal(shouldSkipDir(".github"), true);
  assert.equal(shouldSkipDir("."), true);
  assert.equal(shouldSkipDir("src"), false);
  assert.equal(shouldSkipDir("app"), false);
});

test("A5: shouldSkipDir(name, includes) removes a SKIP_DIRS name from the skip set, but never a dot-dir", () => {
  const includes = new Set(["build", ".git"]);
  assert.equal(shouldSkipDir("build", includes), false, "an included SKIP_DIRS name is no longer skipped");
  assert.equal(shouldSkipDir("vendor", includes), true, "a SKIP_DIRS name NOT in includes is still skipped");
  assert.equal(shouldSkipDir(".git", includes), true, "a dot-dir is never overridable, even if explicitly included");
  assert.equal(shouldSkipDir("src", includes), false);
});

test("A5: walkDir(dir, includes) descends into an included SKIP_DIRS-named directory (filesystem fallback)", () => {
  const dir = mkdtempSync(join(tmpdir(), "graft-walkdir-include-"));
  try {
    mkdirSync(join(dir, "build"), { recursive: true });
    writeFileSync(join(dir, "build", "real.ts"), "export const X = 1;\n");
    mkdirSync(join(dir, "vendor"), { recursive: true });
    writeFileSync(join(dir, "vendor", "other.ts"), "export const Y = 1;\n");

    const withoutIncludes = walkDir(dir).map((f) => f.slice(dir.length + 1));
    assert.ok(!withoutIncludes.some((f) => f.startsWith("build")), "default: build/ is skipped");

    const withIncludes = walkDir(dir, new Set(["build"])).map((f) => f.slice(dir.length + 1));
    assert.ok(withIncludes.some((f) => f.startsWith("build")), "build/ is walked once included");
    assert.ok(!withIncludes.some((f) => f.startsWith("vendor")), "vendor/ stays skipped — only the named dir is included");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A5: in a Git repo, --include-dir lifts the built-in skip for git-visible files", () => {
  const dir = fixture("include-git");
  try {
    write(dir, "src/app.ts");
    write(dir, "vendor/lib.ts"); // vendored dep committed to the repo — visible to git, skipped by the built-in list

    assert.ok(!walked(dir).includes("vendor/lib.ts"), "default: vendor/ is skipped by the built-in list");
    assert.deepEqual(walked(dir, new Set(["vendor"])), ["src/app.ts", "vendor/lib.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A5: --include-dir does not override gitignore — an ignored directory stays excluded even when named", () => {
  const dir = fixture("include-ignored");
  try {
    write(dir, ".gitignore", "build/\n");
    write(dir, "src/app.ts");
    write(dir, "build/gen.ts");

    assert.deepEqual(walked(dir, new Set(["build"])), ["src/app.ts"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** One subdirectory per SKIP_DIRS name, plus a dot-directory and a normal
 * directory — each holding a package.json marker, a source file, and a
 * nested .git, so every check under test (file walk, marker-scope discovery,
 * workspace-glob resolution, git-child discovery) has something to find IF
 * it fails to skip. Deliberately not a git repo, so walkDir exercises the
 * filesystem fallback where the built-in skip list is the only guard. */
function buildSkipFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "graft-skipdirs-"));
  const seed = (relDir: string, sourceName: string) => {
    const sub = join(dir, relDir);
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), "{}");
    writeFileSync(join(sub, sourceName), "export const X = 1;\n");
    mkdirSync(join(sub, ".git"));
  };
  for (const name of SKIP_DIRS) seed(name, "junk.ts");
  seed(".hidden", "junk.ts");
  seed("app", "real.ts");
  return dir;
}

test("walkDir and every scopes.ts consumer agree on the skip set: SKIP_DIRS + a dot-dir are all skipped, a normal dir survives", () => {
  const dir = buildSkipFixture();
  try {
    // walkDir (fs.ts)
    const files = walkDir(dir);
    const rels = files.map((f) => f.slice(dir.length + 1));
    assert.ok(rels.includes(join("app", "real.ts")), "walkDir must still find the normal dir's file");
    for (const name of SKIP_DIRS) {
      assert.ok(!rels.some((r) => r.startsWith(`${name}${"/"}`) || r.startsWith(join(name, ""))), `walkDir must skip ${name}/`);
    }
    assert.ok(!rels.some((r) => r.startsWith(".hidden")), "walkDir must skip the dot-dir");

    // discoverScopes (scopes.ts) — its candidate dirs derive from the walked
    // file set, so a skipped dir's package.json must never surface as a scope.
    const scopes = discoverScopes(dir);
    const prefixes = scopes.map((s) => s.prefix);
    assert.ok(prefixes.includes("app"), "discoverScopes must still find the normal dir's marker");
    for (const name of SKIP_DIRS) assert.ok(!prefixes.includes(name), `discoverScopes must not surface ${name} as a scope`);
    assert.ok(!prefixes.includes(".hidden"), "discoverScopes must not surface the dot-dir as a scope");

    // discoverWorkspaceChildren (scopes.ts)
    const children = discoverWorkspaceChildren(dir);
    assert.ok(children.includes("app"), "discoverWorkspaceChildren must still find the normal git child");
    for (const name of SKIP_DIRS) assert.ok(!children.includes(name), `discoverWorkspaceChildren must skip ${name}`);
    assert.ok(!children.includes(".hidden"), "discoverWorkspaceChildren must skip the dot-dir");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("workspace-glob resolution (scopes.ts's resolveGlob over visible-file dirs) also honors the skip set", () => {
  const dir = buildSkipFixture();
  try {
    // A `packages: ['*']` intent resolves every immediate subdir as a workspace
    // match UNLESS it's absent from the visible-file dir set — if that set
    // stopped agreeing with shouldSkipDir, a SKIP_DIRS name or the dot-dir
    // would show up here as its own scope (workspace matches become candidates
    // even without a marker).
    writeFileSync(join(dir, "pnpm-workspace.yaml"), "packages:\n  - '*'\n");
    const scopes = discoverScopes(dir);
    const prefixes = scopes.map((s) => s.prefix);
    assert.ok(prefixes.includes("app"), "the normal dir must still resolve as a workspace match");
    for (const name of SKIP_DIRS) assert.ok(!prefixes.includes(name), `the glob must not resolve into ${name}`);
    assert.ok(!prefixes.includes(".hidden"), "the glob must not resolve into the dot-dir");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
