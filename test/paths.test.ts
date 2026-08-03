/**
 * Tests for the posix-path invariant (`src/util/paths.ts`) and the `--in` prefix
 * rule that depends on it.
 *
 * The bug these guard against was Windows-only and silent: `relative()` returns
 * the platform separator, so every stored path was `src\gate.ts`, while
 * `pathUnderPrefix` and `map`'s `dirKey` parse paths with `/` by hand. Nothing
 * threw — `--in` just matched nothing, and `map` clustered one "directory" per
 * file.
 *
 * That means most assertions here are trivially true on posix and only bite on
 * Windows, which is why CI runs a `windows-latest` leg. Where a test needs a
 * platform separator it builds one with `join`, never a literal `\`: on posix a
 * literal backslash is a legal filename character, and `toPosixPath` is
 * deliberately keyed to the platform `sep` rather than to both separators so it
 * can't corrupt such a name (and so it is provably the identity on posix, which
 * is what keeps existing Mac/Linux graphs byte-identical across this change).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, sep } from "node:path";
import { normalizePathPrefix, relPosix, stripTrailingSlashes, toPosixPath } from "../src/util/paths.js";
import { pathUnderPrefix } from "../src/graph/scopes.js";

test("toPosixPath: identity on an already-posix path, and idempotent", () => {
  assert.equal(toPosixPath("src/graph/build.ts"), "src/graph/build.ts");
  assert.equal(toPosixPath("build.ts"), "build.ts");
  assert.equal(toPosixPath(""), "");
  const once = toPosixPath(join("src", "graph", "build.ts"));
  assert.equal(toPosixPath(once), once);
  assert.equal(once, "src/graph/build.ts");
});

test("toPosixPath: converts the platform separator", () => {
  // On posix this asserts the identity case; on Windows it asserts the fix.
  assert.equal(toPosixPath(["a", "b", "c"].join(sep)), "a/b/c");
});

test("relPosix: repo-relative and posix on every platform", () => {
  const root = join(sep === "/" ? "/repo" : "C:\\repo");
  assert.equal(relPosix(root, join(root, "src", "gate.ts")), "src/gate.ts");
  assert.equal(relPosix(root, join(root, "gate.ts")), "gate.ts");
  // The output feeds string parsing that assumes `/`, so this is the invariant
  // that actually matters — never a platform separator, whatever the platform.
  assert.ok(!relPosix(root, join(root, "a", "b", "c.ts")).includes("\\"));
});

test("normalizePathPrefix: trailing separators and leading ./ reduce to one form", () => {
  assert.equal(normalizePathPrefix("src"), "src");
  assert.equal(normalizePathPrefix("src/"), "src");
  assert.equal(normalizePathPrefix("src///"), "src");
  assert.equal(normalizePathPrefix("./src"), "src");
  assert.equal(normalizePathPrefix("././src/"), "src");
  // `ask`'s own footer suggests `--in <scope>/` with the slash, so accepting the
  // trailing form is what keeps the tool's suggested next command runnable.
  assert.equal(normalizePathPrefix("server/src/gpu/"), "server/src/gpu");
  // A bare separator means "everywhere", which is how `pathUnderPrefix` reads "".
  assert.equal(normalizePathPrefix("/"), "");
});

test("normalizePathPrefix: a native-separator prefix normalizes to posix", () => {
  // `server\src\gpu` is what a Windows shell's tab-completion produces, and was
  // reported verbatim as matching nothing.
  assert.equal(normalizePathPrefix(join("server", "src", "gpu")), "server/src/gpu");
  assert.equal(normalizePathPrefix(join("server", "src", "gpu") + sep), "server/src/gpu");
});

test("stripTrailingSlashes: linear-time, and leaves interior slashes alone", () => {
  assert.equal(stripTrailingSlashes("src/util"), "src/util");
  assert.equal(stripTrailingSlashes("src/util/"), "src/util");
  assert.equal(stripTrailingSlashes("src/util///"), "src/util");
  assert.equal(stripTrailingSlashes("/"), "");
  assert.equal(stripTrailingSlashes(""), "");
  // The regex this replaces was a polynomial-ReDoS shape (js/polynomial-redos):
  // a long run of trailing slashes must stay cheap, not quadratic.
  assert.equal(stripTrailingSlashes("a" + "/".repeat(50_000)), "a");
});

test("pathUnderPrefix: segment-aware, so a prefix is not a substring", () => {
  assert.ok(pathUnderPrefix("src/gate.ts", "src"));
  assert.ok(pathUnderPrefix("src/a/b/gate.ts", "src/a"));
  // An exact file path is a prefix of itself — `--in src/gate.ts` scopes to one file.
  assert.ok(pathUnderPrefix("src/gate.ts", "src/gate.ts"));
  // The empty prefix matches everything.
  assert.ok(pathUnderPrefix("src/gate.ts", ""));

  // The cases substring matching got wrong, and which unifying grep/callers onto
  // this rule now excludes.
  assert.ok(!pathUnderPrefix("lib/mysrc/x.ts", "src"));
  assert.ok(!pathUnderPrefix("srcfoo/x.ts", "src"));
  assert.ok(!pathUnderPrefix("src/gate.ts", "gate.ts"));
});
